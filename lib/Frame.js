/*
	Portable Image Ase

	Copyright (c) 2024 Cédric Ronvel

	The MIT License (MIT)

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

"use strict" ;



const misc = require( './misc.js' ) ;
const SequentialReadBuffer = require( 'stream-kit/lib/SequentialReadBuffer.js' ) ;
const SequentialWriteBuffer = require( 'stream-kit/lib/SequentialWriteBuffer.js' ) ;



function Frame( ase ) {
	Object.defineProperty( this , 'ase' , { value: ase } ) ;
	this.chunkCount = - 1 ;
	this.duration = ase.defaultFrameDuration ;	// in ms
	this.palette = [] ;
	this.flattenLayers = [] ;
	this.cels = [] ;
}

module.exports = Frame ;

const Ase = require( './Ase.js' ) ;
const Layer = require( './Layer.js' ) ;
const Cel = require( './Cel.js' ) ;



Frame.prototype.toImage = function( PortableImageClass = misc.PortableImage ) {
	var params = this.ase.getPortableImageParams( PortableImageClass ) ;
	var portableImage = new PortableImageClass( params ) ;
	
	for ( let cel of this.cels ) {
		if ( ! cel.layer.visible ) { continue ; }
		let celPortableImage = cel.toImage( PortableImageClass ) ;
		celPortableImage.copyTo( portableImage , {
			compositing: PortableImageClass.compositing.binaryOver ,
			x: cel.x ,
			y: cel.y
		} ) ;
		console.log( "Copy from/to:" , portableImage , celPortableImage ) ;
	}
	
	return portableImage ;
} ;



Frame.prototype.decode = async function( readableBuffer , options = {} ) {
	this.decodeHeader( readableBuffer , options ) ;

	for ( let i = 0 ; i < this.chunkCount ; i ++ ) {
		await this.decodeChunk( readableBuffer , options ) ;
	}
} ;



Frame.prototype.decodeHeader = function( readableBuffer , options = {} ) {
	var frameSize = readableBuffer.readUInt32LE() ;

	var magicNumber = readableBuffer.readUInt16LE() ;
	if ( magicNumber !== 0xf1fa ) {
		throw new Error( "Bad frame, it doesn't start with ASE's frame magic numbers" ) ;
	}

	var chunkCount1 = readableBuffer.readUInt16LE() ;
	this.duration = readableBuffer.readUInt16LE() ;
	readableBuffer.skip( 2 ) ;
	var chunkCount2 = readableBuffer.readUInt32LE() ;

	this.chunkCount = chunkCount2 === 0 ? ( chunkCount1 === 0xffff ? chunkCount2 : chunkCount1 ) : chunkCount2 ;
} ;



Frame.prototype.decodeChunk = async function( readableBuffer , options = {} ) {
	var chunkSize = readableBuffer.readUInt32LE() ;
	var chunkType = readableBuffer.readUInt16LE() ;
	var chunkBuffer = readableBuffer.readBufferView( chunkSize - 6 ) ;

	console.log( "Found chunk:" , chunkType.toString( 16 ) ) ;
	if ( chunkDecoders[ chunkType ] ) {
		await chunkDecoders[ chunkType ].call( this , new SequentialReadBuffer( chunkBuffer ) , options ) ;
	}
} ;



const chunkDecoders = {} ;
const chunkEncoders = {} ;

// Old palette chunk, but still used for palette without alpha
chunkDecoders[ 0x0004 ] = function( readableBuffer , options ) {
	var packets = readableBuffer.readUInt16LE() ;

	for ( let i = 0 ; i < packets ; i ++ ) {
		let skipColors = readableBuffer.readUInt8() ;
		let colorsInPacket = readableBuffer.readUInt8() ;

		for ( let j = 0 ; j < colorsInPacket ; j ++ ) {
			let index = skipColors + j ;
			this.palette[ index ] = [
				readableBuffer.readUInt8() ,
				readableBuffer.readUInt8() ,
				readableBuffer.readUInt8() ,
				this.ase.colorType === Ase.COLOR_TYPE_INDEXED && this.ase.transparencyColorIndex === index ? 0 : 255
			] ;
		}
	}
} ;

// Old palette chunk
chunkDecoders[ 0x0011 ] = function( readableBuffer , options ) {
	console.log( "Old palette chunk 0x0011 is not supported, upgrade your version of Aseprite!" ) ;
} ;


// New palette chunk
chunkDecoders[ 0x2019 ] = function( readableBuffer , options ) {
	var colorCount = readableBuffer.readUInt32LE() ;
	var firstIndex = readableBuffer.readUInt32LE() ;
	var lastIndex = readableBuffer.readUInt32LE() ;
	readableBuffer.skip( 8 ) ;

	for ( let index = firstIndex ; index <= lastIndex ; index ++ ) {
		let flags = readableBuffer.readUInt16LE() ;
		this.palette[ index ] = [
			readableBuffer.readUInt8() ,
			readableBuffer.readUInt8() ,
			readableBuffer.readUInt8() ,
			readableBuffer.readUInt8()
		] ;

		if ( flags & 1 ) {
			// Has name, but what should be done with it? We don't use palette color name ATM...
			let name = readableBuffer.readLps16LEUtf8() ;
			console.log( "Found color name:" , index , name ) ;
		}
	}
} ;


// Layer
chunkDecoders[ 0x2004 ] = function( readableBuffer , options ) {
	var layer = new Layer() ;
	this.flattenLayers.push( layer ) ;

	/*
		Flags:
		1 = Visible
		2 = Editable
		4 = Lock movement
		8 = Background
		16 = Prefer linked cels
		32 = The layer group should be displayed collapsed
		64 = The layer is a reference layer
	*/
	var flags = readableBuffer.readUInt16LE() ;
	layer.visible = !! ( flags & 1 ) ;

	layer.type = readableBuffer.readUInt16LE() ;
	switch ( layer.type ) {
		case 0 :
			// Normal
			break ;
		case 1 :
			// Group
			break ;
		case 2 :
			// Tilemap
			console.log( "Tilemap is unsupported ATM" ) ;
			break ;
	}

	layer.childLevel = readableBuffer.readUInt16LE() ;
	readableBuffer.skip( 4 ) ;	// the doc says that default layer width/height are ignored

	/*
		Blend modes:
		Normal         = 0
		Multiply       = 1
		Screen         = 2
		Overlay        = 3
		Darken         = 4
		Lighten        = 5
		Color Dodge    = 6
		Color Burn     = 7
		Hard Light     = 8
		Soft Light     = 9
		Difference     = 10
		Exclusion      = 11
		Hue            = 12
		Saturation     = 13
		Color          = 14
		Luminosity     = 15
		Addition       = 16
		Subtract       = 17
		Divide         = 18
	*/
	layer.blendMode = readableBuffer.readUInt16LE() ;

	layer.opacity = readableBuffer.readUInt8() ;
	readableBuffer.skip( 3 ) ;	// reserved

	layer.name = readableBuffer.readLps16LEUtf8() ;

	if ( layer.type === 2 ) {
		layer.tilesetIndex = readableBuffer.readUInt32LE() ;
	}

	console.log( "Layer:" , layer ) ;
} ;


// Cel (single-layer image)
chunkDecoders[ 0x2005 ] = async function( readableBuffer , options ) {
	var cel = new Cel() ;
	this.cels.push( cel ) ;

	cel.layerIndex = readableBuffer.readUInt16LE() ;
	cel.x = readableBuffer.readInt16LE() ;
	cel.y = readableBuffer.readInt16LE() ;
	cel.opacity = readableBuffer.readUInt8() ;

	/*
		Cel Type
		0 - Raw Image Data (unused, compressed image is preferred)
		1 - Linked Cel
		2 - Compressed Image
		3 - Compressed Tilemap
	*/
	cel.type = readableBuffer.readUInt16LE() ;

	// z-index is really strange, the real z-index is in fact: layerIndex + zIndex, if equal, zIndex prevails
	cel.zIndex = readableBuffer.readInt16LE() ;

	readableBuffer.skip( 5 ) ;	// reserved

	// Linked Cel
	if ( cel.type === 1 ) {
		cel.linkedFrame = readableBuffer.readUInt16LE() ;
		return ;
	}

	// Tilemap
	if ( cel.type === 3 ) {
		console.log( "Tilemap is unsupported ATM" ) ;
		return ;
	}

	cel.width = readableBuffer.readUInt16LE() ;
	cel.height = readableBuffer.readUInt16LE() ;

	// Raw image
	if ( cel.type === 0 ) {
		let byteLength = cel.width * cel.height * this.ase.bitsPerPixel / 8 ;
		cel.pixelBuffer = readableBuffer.readBufferView( byteLength ) ;
	}

	// Compressed image
	if ( cel.type === 2 ) {
		let expectedByteLength = cel.width * cel.height * this.ase.bitsPerPixel / 8 ;
		let compressedBuffer = readableBuffer.readBufferView( - 1 ) ;
		let decompressedBuffer = await misc.inflate( compressedBuffer ) ;

		if ( decompressedBuffer.length !== expectedByteLength ) {
			throw new Error( "Expected decompressed buffer to have size of " + expectedByteLength + " but got: " + decompressedBuffer.length ) ;
		}

		//console.log( "decompressedBuffer:" , expectedByteLength , decompressedBuffer.length , decompressedBuffer ) ;
		cel.pixelBuffer = decompressedBuffer ;
	}

	console.log( "Cel:" , cel ) ;
} ;


// Color profile, but we don't use them ATM
chunkDecoders[ 0x2007 ] = function( readableBuffer , options ) {
} ;


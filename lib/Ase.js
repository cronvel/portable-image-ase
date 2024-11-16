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


// ASE/ASEPRITE file loader/saver.
// See: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md

const SequentialReadBuffer = require( 'stream-kit/lib/SequentialReadBuffer.js' ) ;
const SequentialWriteBuffer = require( 'stream-kit/lib/SequentialWriteBuffer.js' ) ;


// Includes depending on the environment
var PortableImage = null ;
var DecompressionStream = null ;
var CompressionStream = null ;
var loadFileAsync = null ;
var saveFileAsync = null ;
var download = null ;
var require_ = require ;	// this is used to fool Browserfify, so it doesn't try to include this in the build

if ( process.browser ) {
	PortableImage = window.PortableImage ;
	if ( ! PortableImage ) {
		try {
			PortableImage = require( 'portable-image' ) ;
		}
		catch ( error ) {}
	}

	DecompressionStream = window.DecompressionStream ;
	CompressionStream = window.CompressionStream ;
	loadFileAsync = async ( url ) => {
		var response = await fetch( url ) ;
		if ( ! response.ok ) {
			throw new Error( "Can't retrieve file: '" + url + "', " + response.status + " - " + response.statusText ) ;
		}
		var bytes = await response.bytes() ;
		var buffer = Buffer.from( bytes ) ;
		return buffer ;
	} ;
	saveFileAsync = () => { throw new Error( "Can't save from browser (use .download() instead)" ) ; } ;
	download = ( filename , buffer ) => {
		var anchor = window.document.createElement( 'a' ) ;
		anchor.href = window.URL.createObjectURL( new Blob( [ buffer ] , { type: 'application/octet-stream' } ) ) ;
		anchor.download = filename ;

		// Force a click to start downloading, even if the anchor is not even appended to the body
		anchor.click() ;
	} ;
}
else {
	( { DecompressionStream , CompressionStream } = require_( 'stream/web' ) ) ;

	try {
		PortableImage = require( 'portable-image' ) ;
	}
	catch ( error ) {}

	let fs = require_( 'fs' ) ;
	loadFileAsync = url => fs.promises.readFile( url ) ;
	saveFileAsync = ( url , data ) => fs.promises.writeFile( url , data ) ;
	download = () => { throw new Error( "Can't download from non-browser (use .saveFileAsync() instead)" ) ; } ;
}



function Ase() {
	// Header data
	this.width = - 1 ;
	this.height = - 1 ;
	this.frameCount = - 1 ;
	this.bitsPerPixel = - 1 ;
	this.colorType = - 1 ;

	this.flags = - 1 ;
	this.defaultFrameDuration = - 1 ;
	this.transparencyColorIndex = -1 ;	// transparency index, only for indexed mode
	this.colorCount = - 1 ;
	this.pixelWidth = - 1 ;
	this.pixelHeight = - 1 ;

	this.gridX = 0 ;
	this.gridY = 0 ;
	this.gridWidth = - 1 ;
    this.gridHeight = - 1 ;
    
    // Frames data
    this.frames = [] ;

    // Linked data
    this.palette = null ;
}

module.exports = Ase ;

Ase.PortableImage = PortableImage ;



function Frame( ase ) {
	Object.defineProperty( this , 'ase' , { value: ase } ) ;
	this.chunkCount = - 1 ;
	this.duration = ase.defaultFrameDuration ;	// in ms
	this.palette = [] ;
	this.layers = [] ;
	this.cels = [] ;
}

Ase.Frame = Frame ;



function Layer() {
	this.visible = true ;
	this.type = - 1 ;
	this.childLevel = - 1 ;
	this.blendMode = - 1 ;
	this.opacity = - 1 ;
	this.name = '' ;
	this.tilesetIndex = - 1 ;
}

Ase.Layer = Layer ;



// They call "Cel" a single-layer image
function Cel() {
	this.layerIndex = - 1 ;
	this.width = - 1 ;
	this.height = - 1 ;
	this.x = 0 ;
	this.y = 0 ;
	this.zIndex = 0 ;
	this.opacity = - 1 ;
	this.type = - 1 ;
	
	this.pixelBuffer = null ;

	// Only relevant for linked cel (type=1)
	this.linkedFrame = - 1 ;

	Object.defineProperties( this , {
		frame: { value: null , writable: true } ,
		layer: { value: null , writable: true }
	} ) ;
}

Ase.Cel = Cel ;



Ase.createEncoder = ( params = {} ) => {
	var ase = new Ase() ;

	ase.width = + params.width || 0 ;
	ase.height = + params.height || 0 ;
	ase.bitDepth = + params.bitDepth || 0 ;
	ase.colorType = params.colorType ?? Ase.COLOR_TYPE_INDEXED ;

	ase.compressionMethod = 0 ;
	ase.filterMethod = 0 ;
	ase.interlaceMethod = 0 ;	// unsupported

	if ( Array.isArray( params.palette ) ) { ase.palette = params.palette ; }

	if ( params.pixelBuffer && ( params.pixelBuffer instanceof Buffer ) ) {
		ase.pixelBuffer = params.pixelBuffer ;
	}

	if ( ! ase.bitDepth ) {
		if ( ase.colorType === Ase.COLOR_TYPE_INDEXED ) {
			let colors = ase.palette.length ;
			ase.bitDepth =
				colors <= 2 ? 1 :
				colors <= 4 ? 2 :
				colors <= 16 ? 4 :
				8 ;
		}
		else {
			ase.bitDepth = 8 ;
		}
	}

	ase.computeBitsPerPixel() ;

	return ase ;
} ;



// ASE constants

Ase.COLOR_TYPE_RGBA = 0 ;
Ase.COLOR_TYPE_GRAYSCALE_ALPHA = 1 ;
Ase.COLOR_TYPE_INDEXED = 2 ;



Ase.load = async function( url , options = {} ) {
	var buffer = await loadFileAsync( url ) ;
	return Ase.decode( buffer , options ) ;
} ;

Ase.loadImage = async function( url , options = {} ) {
	var buffer = await loadFileAsync( url ) ;
	return Ase.decodeImage( buffer , options ) ;
} ;



Ase.decode = async function( buffer , options = {} ) {
	var ase = new Ase() ;
	await ase.decode( buffer , options ) ;
	return ase ;
} ;

Ase.decodeImage = function( buffer , options = {} ) {
	var ase = new Ase() ;
	return ase.decodeImage( buffer , options ) ;
} ;



Ase.prototype.toImage = function( PortableImageClass = PortableImage ) {
	// Should merge all visible layers
	
	var cel = this.frames[ 0 ].cels[ 1 ] ;

	var params = {
		width: cel.width ,
		height: cel.height ,
		pixelBuffer: cel.pixelBuffer
	} ;
	console.warn( "pixelBuffer:" , cel.width , cel.height , cel.pixelBuffer ) ;

	switch ( this.colorType ) {
		case Ase.COLOR_TYPE_RGBA :
			params.channels = PortableImageClass.RGBA ;
			break ;
		case Ase.COLOR_TYPE_GRAYSCALE_ALPHA :
			params.channels = [ 'gray' , 'alpha' ] ;
			break ;
		case Ase.COLOR_TYPE_INDEXED :
			params.indexed = true ;
			params.palette = this.palette ;
			params.channels = PortableImageClass.RGBA ;
			break ;
	}

	return new PortableImageClass( params ) ;
} ;



// Sadly it should be async, because browser's Compression API works with streams
Ase.prototype.decode = async function( buffer , options = {} ) {
	var readableBuffer = new SequentialReadBuffer( buffer ) ;
	this.decodeHeader( readableBuffer , options ) ;

	for ( let i = 0 ; i < this.frameCount ; i ++ ) {
		let frame = new Frame( this ) ;
		this.frames.push( frame ) ;
		await frame.decode( readableBuffer ) ;
	}

	this.finalize() ;
} ;



Ase.prototype.decodeImage = async function( buffer , options = {} ) {
	await this.decode( buffer , options ) ;
	console.log( this ) ;
	for ( let frame of this.frames ) { console.log( "Frame:" , frame ) ; }
	return this.toImage( options.PortableImage ) ;
} ;



Ase.prototype.finalize = async function() {
	if ( ! this.frames.length ) { return ; }

	var firstFrame = this.frames[ 0 ] ;

	if ( this.colorType === Ase.COLOR_TYPE_INDEXED ) {
		this.palette = firstFrame.palette ;
	}

	for ( let frame of this.frames ) {
		for ( let cel of frame.cels ) {
			cel.frame = frame ;
			cel.layer = frame.layers[ cel.layerIndex ] ;
		}
	}
} ;



Ase.prototype.decodeHeader = function( readableBuffer , options = {} ) {
	var fileSize = readableBuffer.readUInt32LE() ;
	if ( fileSize !== readableBuffer.buffer.length ) {
		throw new Error( "Expecting a file of size " + fileSize + " but fot " + buffer.length + "." ) ;
	}

	var magicNumber = readableBuffer.readUInt16LE() ;
	if ( magicNumber !== 0xa5e0 ) {
		throw new Error( "Not an ASE, it doesn't start with ASE magic numbers" ) ;
	}

	this.frameCount = readableBuffer.readUInt16LE() ;
	this.width = readableBuffer.readUInt16LE() ;
	this.height = readableBuffer.readUInt16LE() ;

	this.bitsPerPixel = readableBuffer.readUInt16LE() ;

	switch ( this.bitsPerPixel ) {
		case 8 :
			this.colorType = Ase.COLOR_TYPE_INDEXED ;
			break ;
		case 16 :
			this.colorType = Ase.COLOR_TYPE_GRAYSCALE_ALPHA ;
			break ;
		case 32 :
			this.colorType = Ase.COLOR_TYPE_RGBA ;
			break ;
		default :
			throw new Error( "Unsupported number of bits per pixel: " + this.bitsPerPixel ) ;
	}

	this.flags = readableBuffer.readUInt32LE() ;
	this.defaultFrameDuration = readableBuffer.readUInt16LE() ;
	
	readableBuffer.skip( 8 ) ;	// doc said twice: “Set be 0”
	this.transparencyColorIndex = readableBuffer.readUInt8() ;
	readableBuffer.skip( 3 ) ;	// unused
	this.colorCount = readableBuffer.readUInt16LE() ;
	if ( ! this.colorCount && this.colorType === Ase.COLOR_TYPE_INDEXED ) { this.colorCount === 256 ; }

	this.pixelWidth = readableBuffer.readUInt8() ;
	this.pixelHeight = readableBuffer.readUInt8() ;
	if ( ! this.pixelWidth || ! this.pixelHeight ) { this.pixelWidth = this.pixelHeight = 1 ; }

	this.gridX = readableBuffer.readInt16LE() ;
	this.gridY = readableBuffer.readInt16LE() ;
	this.gridWidth = readableBuffer.readUInt16LE() ;
	this.gridHeight = readableBuffer.readUInt16LE() ;
	
	// Unused, reserved for future
	readableBuffer.skip( 84 ) ;
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
	
	this.chunkCount = chunkCount2 === 0 ? ( chunkCount1 === 0xffff ? chunkCount2 : chunkCount1 ) : chunkCount2
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













Ase.prototype.save = async function( url , options = {} ) {
	var buffer = await this.encode( options ) ;
	await saveFileAsync( url , buffer ) ;
} ;



Ase.saveImage = async function( url , portableImage , options = {} ) {
	var ase = Ase.fromImage( portableImage ) ;
	var buffer = await ase.encode( options ) ;
	await saveFileAsync( url , buffer ) ;
} ;



Ase.prototype.download = async function( filename , options = {} ) {
	var buffer = await this.encode( options ) ;
	await download( filename , buffer ) ;
} ;



Ase.fromImage = function( portableImage ) {
	var params = {
		width: portableImage.width ,
		height: portableImage.height ,
		pixelBuffer: portableImage.pixelBuffer
	} ;

	if ( ! portableImage.isRgb && ! portableImage.isRgba && ! portableImage.isGray && ! portableImage.isGrayAlpha ) {
		throw new Error( "The image is not supported, RGB, RGBA, Gray, or Gray+Alpha channels are required" ) ;
	}

	if ( portableImage.indexed ) {
		params.colorType = Ase.COLOR_TYPE_INDEXED ;
		params.palette = portableImage.palette ;
	}
	else if ( portableImage.isRgba ) {
		params.colorType = Ase.COLOR_TYPE_RGBA ;
	}
	else if ( portableImage.isRgb ) {
		params.colorType = Ase.COLOR_TYPE_RGB ;
	}
	else if ( portableImage.isGrayAlpha ) {
		params.colorType = Ase.COLOR_TYPE_GRAYSCALE_ALPHA ;
	}
	else if ( portableImage.isGray ) {
		params.colorType = Ase.COLOR_TYPE_GRAYSCALE ;
	}

	return Ase.createEncoder( params ) ;
} ;



Ase.prototype.encode = async function( options = {} ) {
	var chunks = [] ;

	// Add magic numbers
	//chunks.push( PNG_MAGIC_NUMBERS_BUFFER ) ;

	// IHDR: image header
	await this.addChunk( chunks , 'IHDR' , options ) ;

	// PLTE: the palette for indexed PNG
	await this.addChunk( chunks , 'PLTE' , options ) ;

	// tRNS: the color indexes for transparency
	await this.addChunk( chunks , 'tRNS' , options ) ;

	// bKGD: the default background color
	await this.addChunk( chunks , 'bKGD' , options ) ;

	// IDAT: the image pixel data
	await this.addChunk( chunks , 'IDAT' , options ) ;

	// Finalize by sending the IEND chunk to end the file
	chunks.push( IEND_CHUNK_BUFFER ) ;

	//console.log( "Chunks:" , chunks ) ;
	return Buffer.concat( chunks ) ;
} ;



Ase.prototype.addChunk = async function( chunks , chunkType , options ) {
	if ( ! chunkEncoders[ chunkType ] ) { return ; }

	var dataBuffer = await chunkEncoders[ chunkType ].call( this , options ) ;
	if ( ! dataBuffer ) { return ; }

	var chunkBuffer = this.generateChunkFromData( chunkType , dataBuffer ) ;
	chunks.push( chunkBuffer ) ;
} ;



Ase.prototype.generateChunkFromData = function( chunkType , dataBuffer ) {
	// 4 bytes for the data length | 4 bytes type (ascii) | chunk data (variable length) | 4 bytes of CRC-32 (type + data)
	var chunkBuffer = Buffer.alloc( CHUNK_META_SIZE + dataBuffer.length ) ;

	chunkBuffer.writeInt32BE( dataBuffer.length ) ;
	chunkBuffer.write( chunkType , 4 , 4 , 'latin1' ) ;
	dataBuffer.copy( chunkBuffer , 8 ) ;

	// Add the CRC-32, the 2nd argument of crc32.buf() is the seed, it's like building a CRC
	// of a single buffer containing chunkType + dataBuffer.
	var chunkComputedCrc32 = crc32.buf( dataBuffer , crc32.bstr( chunkType ) ) ;
	chunkBuffer.writeInt32BE( chunkComputedCrc32 , chunkBuffer.length - 4 ) ;
	//console.log( "Generated chunk: '" + chunkType + "' of size: " + dataBuffer.length + " and CRC-32: " + chunkComputedCrc32 ) ;

	return chunkBuffer ;
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
	
	for ( let index = 0 ; index <= lastIndex ; index ++ ) {
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
	this.layers.push( layer ) ;

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
		let uncompressedBuffer = await inflate( compressedBuffer ) ;
		//console.log( "uncompressedBuffer:" , expectedByteLength , uncompressedBuffer.length , uncompressedBuffer ) ;
		cel.pixelBuffer = uncompressedBuffer ;
	}

	console.log( "Cel:" , cel ) ;
} ;


// Color profile, but we don't use them ATM
chunkDecoders[ 0x2007 ] = function( readableBuffer , options ) {
} ;



async function inflate( buffer ) {
	const decompressionStream = new DecompressionStream( 'deflate' ) ;
	const blob = new Blob( [ buffer ] ) ;
	const stream = blob.stream().pipeThrough( decompressionStream ) ;
	//console.log( "Blob bytes:" , await blob.arrayBuffer() ) ;

	const chunks = [] ;
	for await ( let chunk of stream ) { chunks.push( chunk ) ; }

	// Buffer.concat() also accepts Uint8Array
	return Buffer.concat( chunks ) ;
}



async function deflate( buffer ) {
	const compressionStream = new CompressionStream( 'deflate' ) ;
	const blob = new Blob( [ buffer ] ) ;
	const stream = blob.stream().pipeThrough( compressionStream ) ;
	//console.log( "Blob bytes:" , await blob.arrayBuffer() ) ;

	const chunks = [] ;
	for await ( let chunk of stream ) { chunks.push( chunk ) ; }

	// Buffer.concat() also accepts Uint8Array
	return Buffer.concat( chunks ) ;
}


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



/*
	ASE/ASEPRITE file loader/saver.
	See: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
*/

const misc = require( './misc.js' ) ;
const SequentialReadBuffer = require( 'stream-kit/lib/SequentialReadBuffer.js' ) ;
const SequentialWriteBuffer = require( 'stream-kit/lib/SequentialWriteBuffer.js' ) ;



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

const Frame = Ase.Frame = require( './Frame.js' ) ;
const Layer = Ase.Layer = require( './Layer.js' ) ;
const Cel = Ase.Cel = require( './Cel.js' ) ;

Ase.PortableImage = misc.PortableImage ;



// ASE constants

Ase.COLOR_TYPE_RGBA = 0 ;
Ase.COLOR_TYPE_GRAYSCALE_ALPHA = 1 ;
Ase.COLOR_TYPE_INDEXED = 2 ;



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



Ase.load = async function( url , options = {} ) {
	var buffer = await misc.loadFileAsync( url ) ;
	return Ase.decode( buffer , options ) ;
} ;

Ase.loadImage = async function( url , options = {} ) {
	var buffer = await misc.loadFileAsync( url ) ;
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



Ase.prototype.toImage = function( ImageClass = misc.PortableImage.Image ) {
	// Only the first frame
	return this.frames[ 0 ].toImage( ImageClass ) ;
} ;



Ase.prototype.getImageParams = function( ImageClass = misc.PortableImage.Image ) {
	var params = {
		width: this.width ,
		height: this.height ,
	} ;

	switch ( this.colorType ) {
		case Ase.COLOR_TYPE_RGBA :
			params.channels = ImageClass.ChannelDef.RGBA ;
			break ;
		case Ase.COLOR_TYPE_GRAYSCALE_ALPHA :
			params.channels = [ 'gray' , 'alpha' ] ;
			break ;
		case Ase.COLOR_TYPE_INDEXED :
			params.indexed = true ;
			params.palette = this.palette ;
			params.channels = ImageClass.ChannelDef.RGBA ;
			break ;
	}

	return params ;
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
	return this.toImage( options.Image ) ;
} ;



Ase.prototype.finalize = async function() {
	if ( ! this.frames.length ) { return ; }

	var firstFrame = this.frames[ 0 ] ;

	if ( this.colorType === Ase.COLOR_TYPE_INDEXED ) {
		this.palette = firstFrame.palette ;
	}

	for ( let frame of this.frames ) {
		for ( let cel of frame.cels ) {
			cel.ase = this ;
			cel.frame = frame ;
			cel.layer = frame.flattenLayers[ cel.layerIndex ] ;
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











Ase.prototype.save = async function( url , options = {} ) {
	var buffer = await this.encode( options ) ;
	await misc.saveFileAsync( url , buffer ) ;
} ;



Ase.saveImage = async function( url , image , options = {} ) {
	var ase = Ase.fromImage( image ) ;
	var buffer = await ase.encode( options ) ;
	await misc.saveFileAsync( url , buffer ) ;
} ;



Ase.prototype.download = async function( filename , options = {} ) {
	var buffer = await this.encode( options ) ;
	await misc.download( filename , buffer ) ;
} ;



Ase.fromImage = function( image ) {
	var params = {
		width: image.width ,
		height: image.height ,
		pixelBuffer: image.pixelBuffer
	} ;

	if ( ! image.channelDef.isRgb && ! image.channelDef.isRgba && ! image.channelDef.isGray && ! image.channelDef.isGrayAlpha ) {
		throw new Error( "The image is not supported, RGB, RGBA, Gray, or Gray+Alpha channels are required" ) ;
	}

	if ( image.channelDef.indexed ) {
		params.colorType = Ase.COLOR_TYPE_INDEXED ;
		params.palette = image.channelDef.palette ;
	}
	else if ( image.channelDef.isRgba ) {
		params.colorType = Ase.COLOR_TYPE_RGBA ;
	}
	else if ( image.channelDef.isRgb ) {
		params.colorType = Ase.COLOR_TYPE_RGB ;
	}
	else if ( image.channelDef.isGrayAlpha ) {
		params.colorType = Ase.COLOR_TYPE_GRAYSCALE_ALPHA ;
	}
	else if ( image.channelDef.isGray ) {
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


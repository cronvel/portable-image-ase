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
	this.transparencyColorIndex = null ;	// transperency index, only for indexed mode
	this.colorCount = - 1 ;
	this.pixelWidth = - 1 ;
	this.pixelHeight = - 1 ;

	this.gridX = 0 ;
	this.gridY = 0 ;
	this.gridWidth = - 1 ;
    this.gridHeight = - 1 ;
    
    
    // Frame data
    
    this.frames = [] ;
	
	
	// ----

	this.palette = [] ;
	this.pixelBuffer = null ;
}

module.exports = Ase ;

Ase.PortableImage = PortableImage ;



function Frame( duration ) {
	// Header data

	this.chunkCount = - 1 ;
	this.duration = duration ;	// in ms
	
	// ----

	this.palette = [] ;
	this.pixelBuffer = null ;
}

Ase.Frame = Frame ;



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



// PNG constants

Ase.COLOR_TYPE_RGBA = 0 ;
Ase.COLOR_TYPE_GRAYSCALE_ALPHA = 1 ;
Ase.COLOR_TYPE_INDEXED = 2 ;



// Chunk/Buffer constants

const CHUNK_META_SIZE = 12 ;
// A PNG file always starts with this bytes
const PNG_MAGIC_NUMBERS = [ 0x89 , 0x50 , 0x4E , 0x47 , 0x0D , 0x0A , 0x1A , 0x0A ] ;
const PNG_MAGIC_NUMBERS_BUFFER = Buffer.from( PNG_MAGIC_NUMBERS ) ;
const IEND_CHUNK = [	// Instead of triggering the whole chunk machinery, just put this pre-computed IEND chunk
	0x00 , 0x00 , 0x00 , 0x00 ,		// Zero-length
	0x49 , 0x45 , 0x4e , 0x44 ,		// IEND
	0xae , 0x42 , 0x60 , 0x82		// CRC-32 of IEND
] ;
const IEND_CHUNK_BUFFER = Buffer.from( IEND_CHUNK ) ;



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
	var params = {
		width: this.width ,
		height: this.height ,
		pixelBuffer: this.pixelBuffer
	} ;

	switch ( this.colorType ) {
		case Ase.COLOR_TYPE_RGB :
			params.channels = PortableImageClass.RGB ;
			break ;
		case Ase.COLOR_TYPE_RGBA :
			params.channels = PortableImageClass.RGBA ;
			break ;
		case Ase.COLOR_TYPE_GRAYSCALE :
			params.channels = [ 'gray' ] ;
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
		let frame = new Frame( this.defaultFrameDuration ) ;
		this.frames.push( frame ) ;
		await frame.decode( readableBuffer ) ;
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
	var chunkBuffer = readableBuffer.readBuffer( chunkSize - 6 , true ) ;
	
	console.log( "Found chunk:" , chunkType.toString( 16 ) ) ;
	if ( chunkDecoders[ chunkType ] ) {
		await chunkDecoders[ chunkType ].call( this , new SequentialReadBuffer( chunkBuffer ) , options ) ;
	}
} ;













Ase.prototype.decodeImage = async function( buffer , options = {} ) {
	await this.decode( buffer , options ) ;
	console.log( this ) ;
	for ( let frame of this.frames ) { console.log( "Frame:" , frame ) ; }
	return this.toImage( options.PortableImage ) ;
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
	chunks.push( PNG_MAGIC_NUMBERS_BUFFER ) ;

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
				255
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
	var visible = !! ( flags & 1 ) ;

	var type = readableBuffer.readUInt16LE() ;
	switch ( type ) {
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

	var childLevel = readableBuffer.readUInt16LE() ;
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
	var blendMode = readableBuffer.readUInt16LE() ;

	var opacity = readableBuffer.readUInt8() ;
	readableBuffer.skip( 3 ) ;	// reserved
	
	var name = readableBuffer.readLps16LEUtf8() ;
	
	if ( type === 2 ) {
		let tilesetIndex = readableBuffer.readUInt32LE() ;
	}
	
	console.log( "Layer:" , { name , type , visible , childLevel , blendMode } ) ;
} ;


// Color profile, but we don't use them ATM
chunkDecoders[ 0x2007 ] = function( readableBuffer , options ) {
} ;


chunkDecoders.IHDR = function( readableBuffer , options ) {
	this.width = readableBuffer.readUInt32BE() ;
	this.height = readableBuffer.readUInt32BE() ;
	this.bitDepth = readableBuffer.readUInt8() ;
	this.colorType = readableBuffer.readUInt8() ;
	this.compressionMethod = readableBuffer.readUInt8() ;
	this.filterMethod = readableBuffer.readUInt8() ;
	this.interlaceMethod = readableBuffer.readUInt8() ;

	this.computeBitsPerPixel() ;

	//console.log( "After IHDR:" , this ) ;
} ;



chunkEncoders.IHDR = function( options ) {
	let writableBuffer = new SequentialWriteBuffer( 13 ) ;

	writableBuffer.writeUInt32BE( this.width ) ;
	writableBuffer.writeUInt32BE( this.height ) ;
	writableBuffer.writeUInt8( this.bitDepth ) ;
	writableBuffer.writeUInt8( this.colorType ) ;
	writableBuffer.writeUInt8( this.compressionMethod ) ;
	writableBuffer.writeUInt8( this.filterMethod ) ;
	writableBuffer.writeUInt8( this.interlaceMethod ) ;

	return writableBuffer.getBuffer( true ) ;
} ;



chunkDecoders.IDAT = function( readableBuffer , options ) {
	this.idatBuffers.push( readableBuffer.buffer ) ;
	//console.log( "Raw IDAT:" , readableBuffer.buffer , readableBuffer.buffer.length ) ;
} ;



chunkEncoders.IDAT = async function( options ) {
	if ( ! this.pixelBuffer ) { return ; }

	//if ( this.colorType !== Ase.COLOR_TYPE_INDEXED ) { throw new Error( "Unsupported color type for IDAT: " + this.colorType ) ; }

	if ( this.interlaceMethod ) {
		throw new Error( "Interlace methods are unsupported (IDAT): " + this.interlaceMethod ) ;
	}

	//console.log( "Creating IDAT with bits per pixel / bit depth: " + this.bitsPerPixel + " / " + this.bitDepth ) ;

	var pixelBufferLineByteLength = this.width * this.decodedBytesPerPixel ;
	var lineByteLength = 1 + Math.ceil( this.width * this.bitsPerPixel / 8 ) ;
	var writableBuffer = new SequentialWriteBuffer( this.palette.length * 3 ) ;

	// Prepare the PNG buffer, using only filter 0 and no Adam7, we just want it to work
	for ( let y = 0 ; y < this.height ; y ++ ) {
		// We don't care for filters ATM, it requires heuristic, it's boring to do...
		writableBuffer.writeUInt8( 0 ) ;

		if ( this.bitsPerPixel >= 8 ) {
			writableBuffer.writeBuffer( this.pixelBuffer , y * pixelBufferLineByteLength , ( y + 1 ) * pixelBufferLineByteLength ) ;
		}
		else {
			for ( let x = 0 ; x < this.width ; x ++ ) {
				writableBuffer.writeUBits( this.pixelBuffer[ y * pixelBufferLineByteLength + x ] , this.bitsPerPixel ) ;
			}
		}
	}

	var compressedBuffer = await deflate( writableBuffer.getBuffer( true ) ) ;
	//console.log( "Compressed IDAT:" , compressedBuffer , compressedBuffer.length ) ;

	return compressedBuffer ;
} ;



Ase.prototype.generateImageData = async function() {
	if ( this.interlaceMethod ) {
		throw new Error( "Interlace methods are unsupported (IDAT): " + this.interlaceMethod ) ;
	}

	this.pixelBuffer = Buffer.allocUnsafe( this.width * this.height * this.decodedBytesPerPixel ) ;

	var compressedBuffer = Buffer.concat( this.idatBuffers ) ;
	var buffer = await inflate( compressedBuffer ) ;
	//console.log( "Decompressed IDAT:" , buffer , buffer.length ) ;

	var lineByteLength = 1 + Math.ceil( this.width * this.bitsPerPixel / 8 ) ;
	var expectedBufferLength = lineByteLength * this.height ;
	var pixelBufferLineByteLength = this.width * this.decodedBytesPerPixel ;

	if ( expectedBufferLength !== buffer.length ) {
		throw new Error( "Expecting a decompressed buffer of length of " + expectedBufferLength + " but got: " + buffer.length ) ;
	}

	//console.log( "lineByteLength:" , lineByteLength ) ;
	for ( let y = 0 ; y < this.height ; y ++ ) {
		this.decodeLineFilter( buffer , y * lineByteLength , ( y + 1 ) * lineByteLength , ( y - 1 ) * lineByteLength ) ;	// Note: negative number = no previous line
		this.extractLine( buffer , y * lineByteLength + 1 , lineByteLength - 1 , y * pixelBufferLineByteLength ) ;
	}

	//console.log( "pixelBuffer:" , this.pixelBuffer , this.pixelBuffer.length ) ;
} ;



Ase.prototype.computeBitsPerPixel = function() {
	switch ( this.colorType ) {
		case Ase.COLOR_TYPE_GRAYSCALE :
		case Ase.COLOR_TYPE_INDEXED :
			this.bitsPerPixel = this.bitDepth ;
			break ;
		case Ase.COLOR_TYPE_RGB :
			this.bitsPerPixel = this.bitDepth * 3 ;
			break ;
		case Ase.COLOR_TYPE_GRAYSCALE_ALPHA :
			this.bitsPerPixel = this.bitDepth * 2 ;
			break ;
		case Ase.COLOR_TYPE_RGBA :
			this.bitsPerPixel = this.bitDepth * 4 ;
			break ;
	}

	this.decodedBytesPerPixel = Math.ceil( this.bitsPerPixel / 8 ) ;
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


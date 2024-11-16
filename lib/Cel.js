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



// They call "Cel" a single-layer image
function Cel() {
	Object.defineProperties( this , {
		ase: { value: null , writable: true } ,
		frame: { value: null , writable: true } ,
		layer: { value: null , writable: true }
	} ) ;

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
}

module.exports = Cel ;

const Ase = require( './Ase.js' ) ;



Cel.prototype.toImage = function( PortableImageClass = misc.PortableImage ) {
	var params = {
		width: this.width ,
		height: this.height ,
		pixelBuffer: this.pixelBuffer
	} ;
	console.warn( "pixelBuffer:" , this.width , this.height , this.pixelBuffer ) ;

	switch ( this.ase.colorType ) {
		case Ase.COLOR_TYPE_RGBA :
			params.channels = PortableImageClass.RGBA ;
			break ;
		case Ase.COLOR_TYPE_GRAYSCALE_ALPHA :
			params.channels = [ 'gray' , 'alpha' ] ;
			break ;
		case Ase.COLOR_TYPE_INDEXED :
			params.indexed = true ;
			params.palette = this.ase.palette ;
			params.channels = PortableImageClass.RGBA ;
			break ;
	}

	return new PortableImageClass( params ) ;
} ;


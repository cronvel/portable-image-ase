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



Cel.prototype.toImage = function( ImageClass = misc.PortableImage.Image ) {
	var params = this.ase.getImageParams( ImageClass ) ;
	params.width = this.width ;
	params.height = this.height ;
	params.pixelBuffer = this.pixelBuffer ;

	return new ImageClass( params ) ;
} ;



Cel.prototype.toSpriteImage = function( sprite ) {
	var params = {
		channelDef: sprite.channelDef ,
		width: this.width ,
		height: this.height ,
		pixelBuffer: this.pixelBuffer
	} ;

	return new sprite.Image( params ) ;
} ;



Cel.prototype.addSpriteCell = function( spriteFrame ) {
	var sprite = spriteFrame.sprite ;
	var spriteImage = this.toSpriteImage( sprite ) ;
	var imageIndex = sprite.addImage( spriteImage ) ;
	var spriteCell = new sprite.Cell( {
		imageIndex ,
		x: this.x ,
		y: this.y
	} ) ;

	spriteFrame.addCell( spriteCell ) ;
} ;


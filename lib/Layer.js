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



function Layer() {
	this.name = '' ;
	this.type = - 1 ;
	this.visible = true ;
	this.childLevel = - 1 ;
	this.blendMode = - 1 ;
	this.opacity = - 1 ;
	this.tilesetIndex = - 1 ;
}

module.exports = Layer ;



Layer.TYPE_IMAGE = 0 ;
Layer.TYPE_GROUP = 1 ;
Layer.TYPE_TILEMAP = 2 ;

Layer.BLEND_NORMAL = 0 ;
Layer.BLEND_MULTIPLY = 1 ;
Layer.BLEND_SCREEN = 2 ;
Layer.BLEND_OVERLAY = 3 ;
Layer.BLEND_DARKEN = 4 ;
Layer.BLEND_LIGHTEN = 5 ;
Layer.BLEND_COLOR_DODGE = 6 ;
Layer.BLEND_COLOR_BURN = 7 ;
Layer.BLEND_HARD_LIGHT = 8 ;
Layer.BLEND_SOFT_LIGHT = 9 ;
Layer.BLEND_DIFFERENCE = 10 ;
Layer.BLEND_EXCLUSION = 11 ;
Layer.BLEND_HUE = 12 ;
Layer.BLEND_SATURATION = 13 ;
Layer.BLEND_COLOR = 14 ;
Layer.BLEND_LUMINOSITY = 15 ;
Layer.BLEND_ADDITION = 16 ;
Layer.BLEND_SUBTRACT = 17 ;
Layer.BLEND_DIVIDE = 18 ;



Layer.prototype.addSpriteLayer = function( sprite ) {
	if ( this.type !== Layer.TYPE_IMAGE ) { return ; }

	var spriteLayer = new sprite.Layer( this.name , {
		visible: this.visible ,
		opacity: this.opacity / 255
	} ) ;

	sprite.addLayer( spriteLayer ) ;

	return spriteLayer ;
} ;


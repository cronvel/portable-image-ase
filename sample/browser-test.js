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



const Ase = PortableImageAse ;
const PortableImage = Ase.PortableImage ;



async function testImage() {
	var filename , imageDataParams , ase , portableImage ,
		$canvas = document.getElementById( 'canvas' ) ,
		ctx = $canvas.getContext( '2d' ) ;

	//filename = 'heart.ase' ;
	filename = 'anim.ase' ;
	ase = await Ase.load( filename ) ;
	console.log( "Ase:" , ase ) ;

	portableImage = ase.toImage() ;
	console.log( "PortableImage:" , portableImage ) ;

	//ctx.fillStyle = "green"; ctx.fillRect(0, 0, 100, 100);

	//imageDataParams = {} ;
	imageDataParams = {
		scaleX: 10 , scaleY: 10
		//scaleX: 20 , scaleY: 20
	} ;

	var imageData = portableImage.createImageData( imageDataParams ) ;
	ctx.putImageData( imageData , 0 , 0 ) ;
}



async function testAnimator() {
	var filename , imageDataParams , ase , portableSprite ,
		$canvas = document.getElementById( 'canvas' ) ,
		ctx = $canvas.getContext( '2d' ) ;

	//filename = 'heart.ase' ;
	filename = 'anim.ase' ;
	ase = await Ase.load( filename ) ;
	console.log( "Ase:" , ase ) ;

	portableSprite = ase.toSprite() ;
	console.log( "PortableSprite:" , portableSprite ) ;

	portableSprite.flatten() ;
	console.log( "PortableSprite:" , portableSprite ) ;

	//ctx.fillStyle = "green"; ctx.fillRect(0, 0, 100, 100);

	var animator = portableSprite.createAnimator( {
		ctx ,
		scaleX: 10 ,
		scaleY: 10 ,
		useCache: true
	} ) ;

	animator.start() ;
}



// Like jQuery's $(document).ready()
const ready = callback => {
    document.addEventListener( 'DOMContentLoaded' , function internalCallback() {
        document.removeEventListener( 'DOMContentLoaded' , internalCallback , false ) ;
        callback() ;
    } , false ) ;
} ;



//ready( testImage ) ;
ready( testAnimator ) ;



/**
 * This script calculates and renders the arrow indicators
 * on the sides of the screen, pointing to pieces off-screen
 * that are in that direction.
 * 
 * If the pictues are clicked, we initiate a teleport to that piece.
 */

import type { BufferModel, BufferModelInstanced } from './buffermodel.js';
import type { Coords, CoordsKey } from '../../chess/util/coordutil.js';
import type { Piece } from '../../chess/logic/boardchanges.js';
import type { Color } from '../../chess/util/colorutil.js';
import type { BoundingBox, Corner, Vec2, Vec2Key } from '../../util/math.js';
import type { LineKey, LinesByStep, PieceLinesByKey } from '../../chess/logic/organizedlines.js';
// @ts-ignore
import type gamefile from '../../chess/logic/gamefile.js';
// @ts-ignore
import type { LegalMoves } from '../chess/selection.js';

import spritesheet from './spritesheet.js';
import gameslot from '../chess/gameslot.js';
import guinavigation from '../gui/guinavigation.js';
import guigameinfo from '../gui/guigameinfo.js';
import { createModel } from './buffermodel.js';
import colorutil from '../../chess/util/colorutil.js';
import jsutil from '../../util/jsutil.js';
import coordutil from '../../chess/util/coordutil.js';
import math from '../../util/math.js';
import organizedlines from '../../chess/logic/organizedlines.js';
import gamefileutility from '../../chess/util/gamefileutility.js';
import legalmovehighlights from './highlights/legalmovehighlights.js';
import onlinegame from '../misc/onlinegame/onlinegame.js';
import frametracker from './frametracker.js';
// @ts-ignore
import bufferdata from './bufferdata.js';
// @ts-ignore
import legalmoves from '../../chess/logic/legalmoves.js';
// @ts-ignore
import input from '../input.js';
// @ts-ignore
import perspective from './perspective.js';
// @ts-ignore
import transition from './transition.js';
// @ts-ignore
import movement from './movement.js';
// @ts-ignore
import options from './options.js';
// @ts-ignore
import selection from '../chess/selection.js';
// @ts-ignore
import camera from './camera.js';
// @ts-ignore
import board from './board.js';
// @ts-ignore
import moveutil from '../../chess/util/moveutil.js';
// @ts-ignore
import space from '../misc/space.js';


// Type Definitions --------------------------------------------------------------------


/** Contains the legal moves, and other info, about the piece an arrow indicator is pointing to. */
interface ArrowLegalMoves {
	/** The Piece this arrow is pointing to, including its coords & type. */
	piece: Piece,
	/** The calculated legal moves of the piece. */
	legalMoves: LegalMoves,
	/** The buffer model for rendering the non-capturing legal moves of the piece. */
	model_NonCapture: BufferModelInstanced,
	/** The buffer model for rendering the capturing legal moves of the piece. */
	model_Capture: BufferModelInstanced,
	/** The [r,b,g,a] values these legal move highlights should be rendered.
	 * Depends on whether the piece is ours, a premove, or an opponent's piece. */
	color: Color
}

/**
 * An object storing an object for every slide direction / line of the game.
 * And in that object are objects for each line on the plane of that slide direction.
 * And in each of those objects are stored pieces that have a chance of receiving
 * an arrow for them this frame, depending on the mode,
 * and a boolean indicating whether they can legally slide onto the screen area.
 */
interface SlideArrowsDraft {
	/** An object containing all existing arrows for a specific slide direction */
	[vec2Key: Vec2Key]: {
		/**
		 * A single line containing what arrows should be visible on the
		 * sides of the screen for offscreen pieces.
		 */
		[lineKey: string]: ArrowsLineDraft
	}
}

/**
 * An object containing the arrows that should actually be present,
 * for a single organized line intersecting through our screen.
 * 
 * The FIRST index in each of these left/right arrays, is the picture
 * which gets rendered at the default location.
 * The FINAL index in each of these, is the picture of the piece
 * that is CLOSEST to you (or the screen) on the line!
 */
interface ArrowsLineDraft {
	/** Piece on this line that intersect the screen with a positive dot product. */
	posDotProd: Entry[],
	/** Piece on this line that intersect the screen with a negative dot product.
	 * The arrow direction for these will be flipped to the other side. */
	negDotProd: Entry[]
}

type Entry = { piece: Piece, canSlideOntoScreen: boolean };




interface SlideArrows {
	/** An object containing all existing arrows for a specific slide direction */
	[vec2Key: Vec2Key]: {
		/**
		 * A single line containing what arrows ARE visible on the
		 * sides of the screen for offscreen pieces.
		 */
		[lineKey: string]: ArrowsLine
	}
}

/**
 * An object containing the arrows that should actually be present,
 * for a single organized line intersecting through our screen.
 * 
 * The FIRST index in each of these left/right arrays, is the picture
 * which gets rendered at the default location.
 * The FINAL index in each of these, is the picture of the piece
 * that is CLOSEST to you (or the screen) on the line!
 */
interface ArrowsLine {
	/** Piece on this line that intersect the screen with a positive dot product.
	 * SORTED in order of closest to the screen to farthest. */
	posDotProd: Arrow[],
	/** Piece on this line that intersect the screen with a negative dot product.
	 * SORTED in order of closest to the screen to farthest.
	 * The arrow direction for these will be flipped to the other side. */
	negDotProd: Arrow[]
}

interface Arrow {
	worldLocation: Coords,
	piece: Piece,
	hovered: boolean,
}



interface HoveredArrow {
	/**
	 * The slide direction / slope / step for this arrow.
	 * Is the same as the direction the arrow is pointing.
	 */
	// slideDir: Vec2,
	/** The key of the organized line that it is on */
	// lineKey: LineKey,
	/** A reference to the piece it is pointing to */
	piece: Piece
}






// Variables ----------------------------------------------------------------------------


/** The width of the mini images of the pieces and arrows, in percentage of 1 tile. */
const width: number = 0.65;
/** How much padding to include between the mini image of the pieces & arrows and the edge of the screen, in percentage of 1 tile. */
const sidePadding: number = 0.15; // Default: 0.15   0.1 Lines up the tip of the arrows right against the edge
/** How much separation between adjacent pictures pointing to multiple pieces on the same line, in percentage of 1 tile. */
const paddingBetwAdjacentPictures: number = 0.35;
/** Opacity of the mini images of the pieces and arrows. */
const opacity: number = 0.6;
/** When we're zoomed out far enough that 1 tile is as wide as this many virtual pixels, we don't render the arrow indicators. */
const renderZoomLimitVirtualPixels: number = 10; // virtual pixels. Default: 14

/** The distance in perspective mode to render the arrow indicators from the camera.
 * We need this because there is no normal edge of the screen like in 2D mode. */
const perspectiveDist = 17;


/**
 * The mode the arrow indicators on the edges of the screen is currently in.
 * 0 = Off,
 * 1 = Defense,
 * 2 = All (orthogonals & diagonals)
 * 3 = All (including hippogonals, only used in variants using hippogonals)
 */
let mode: 0 | 1 | 2 | 3 = 1;

/**
 * A list of all arrows being hovered over this frame.
 * Other scripts may access this so they can add interaction with them.
 */
const hoveredArrows: HoveredArrow[] = [];

/**
 * An array storing the LegalMoves, model and other info, for rendering the legal move highlights
 * of piece arrow indicators currently being hovered over!
 * 
 * THIS IS UPDATED AFTER OTHER SCRIPTS have a chance to add/delete pieces to show arrows for,
 * as hovered arrows have a chance of being removed before rendering!
 */
const hoveredArrowsLegalMoves: ArrowLegalMoves[] = [];



/**
 * A list of all arrows present for the current frame.
 * 
 * Other scripts need to be given an opportunity to add/remove
 * arrows from this list.
 */
// const arrowsData: Arrow[] = [];
let slideArrows: SlideArrows = {};


// Functions ------------------------------------------------------------------------------


/**
 * Returns the mode the arrow indicators on the edges of the screen is currently in.
 */
function getMode(): typeof mode {
	return mode;
}

/**
 * Sets the rendering mode of the arrow indicators on the edges of the screen.
 */
function setMode(value: typeof mode) {
	mode = value;
	if (mode === 0) hoveredArrowsLegalMoves.length = 0; // Erase, otherwise their legal move highlights continue to render
}

/** Rotates the current mode of the arrow indicators. */
function toggleArrows() {
	frametracker.onVisualChange();
	// Have to do it weirdly like this, instead of using '++', because typescript complains that nextMode is of type number.
	let nextMode: typeof mode = mode === 0 ? 1 : mode === 1 ? 2 : mode === 2 ? 3 : /* mode === 3 ? */ 0;
	// Calculate the cap
	const cap = gameslot.getGamefile()!.startSnapshot.hippogonalsPresent ? 3 : 2;
	if (nextMode > cap) nextMode = 0; // Wrap back to zero
	setMode(nextMode);
}

/**
 * Calculates what arrows should be visible this frame.
 * 
 * Needs to be done every frame, even if the mouse isn't moved,
 * since actions such as rewinding/forwarding may change them,
 * or board velocity.
 * 
 * DOES NOT GENERATE THE MODEL OF THE hovered arrow legal moves.
 * This is so that other script have the opportunity to modify the list of
 * visible arrows before rendering.
 */
function update() {
	if (mode === 0) return; // Arrow indicators are off, nothing is visible.
	if (board.gtileWidth_Pixels(true) < renderZoomLimitVirtualPixels) { // Too zoomed out, the arrows would be really tiny.
		hoveredArrowsLegalMoves.length = 0;
		return;
	}

	/**
	 * To be able to test if a piece is offscreen or not,
	 * we need to know the bounding box of the visible board.
	 * 
	 * Even if a tiny portion of the square the piece is on
	 * is visible on screen, we will not create an arrow for it.
	 */
	const { boundingBoxInt, boundingBoxFloat } = getBoundingBoxesOfVisibleScreen();

	/**
	 * Next, we are going to iterate through each slide existing in the game,
	 * and for each of them, iterate through all organized lines of that slope,
	 * for each one of those lines, if they intersect our screen bounding box,
	 * we will iterate through all its pieces, adding an arrow for them
	 * ONLY if they are not visible on screen...
	 */

	/** The object that stores all arrows that should be visible this frame. */
	const slideArrows: SlideArrowsDraft = generateAllArrows(boundingBoxInt, boundingBoxFloat);

	// If we are in only-show-attackers mode
	removeUnnecessaryArrows(slideArrows);
	// console.log("Arrows after removing unnecessary:");
	// console.log(slideArrows);

	// Calculate what arrows are being hovered over...

	// First we need to add the additional padding to the bounding box,
	// so that the arrows aren't touching the screen edge.
	addArrowsPaddingToBoundingBox(boundingBoxFloat);


	// Calc the model data...

	calculateInstanceData_AndArrowsHovered(slideArrows, boundingBoxFloat);
}

/**
 * Calculates the visible bounding box of the screen for this frame,
 * both the integer-rounded, and the exact floating point one.
 * 
 * These boxes are used to test whether a piece is visible on-screen or not.
 * As if it's not, it should get an arrow.
 */
function getBoundingBoxesOfVisibleScreen(): { boundingBoxInt: BoundingBox, boundingBoxFloat: BoundingBox } {
	// Same as above, but doesn't round
	const boundingBoxFloat: BoundingBox = perspective.getEnabled() ? board.generatePerspectiveBoundingBox(perspectiveDist) : board.gboundingBoxFloat();

	// Apply the padding of the navigation and gameinfo bars to the screen bounding box.
	if (!perspective.getEnabled()) { // Perspective is OFF
		let headerPad = space.convertPixelsToWorldSpace_Virtual(guinavigation.getHeightOfNavBar());
		let footerPad = space.convertPixelsToWorldSpace_Virtual(guigameinfo.getHeightOfGameInfoBar());
		// Reverse header and footer pads if we're viewing black's side
		if (!gameslot.isLoadedGameViewingWhitePerspective()) [headerPad, footerPad] = [footerPad, headerPad]; // Swap values
		// Apply the paddings to the bounding box
		boundingBoxFloat.top -= space.convertWorldSpaceToGrid(headerPad);
		boundingBoxFloat.bottom += space.convertWorldSpaceToGrid(footerPad);
	}

	// If any part of the square is on screen, this box rounds outward to contain it.
	const boundingBoxInt = board.roundAwayBoundingBox(boundingBoxFloat);

	return { boundingBoxInt, boundingBoxFloat };
}

/**
 * Adds a little bit of padding to the bounding box, so that the arrows of the
 * arrows indicators aren't touching the edge of the screen.
 * 
 * DESTRUCTIVE, modifies the provided BoundingBox.
 */
function addArrowsPaddingToBoundingBox(boundingBoxFloat: BoundingBox) {
	const padding = width / 2 + sidePadding;
	boundingBoxFloat.top -= padding;
	boundingBoxFloat.right -= padding;
	boundingBoxFloat.bottom += padding;
	boundingBoxFloat.left += padding;
}

/**
 * Generates all the arrows for a game, as if All (plus hippogonals) mode was on.
 */
function generateAllArrows(boundingBoxInt: BoundingBox, boundingBoxFloat: BoundingBox): SlideArrowsDraft {
	/** The running list of arrows that should be visible */
	const slideArrows: SlideArrowsDraft = {};
	const gamefile = gameslot.getGamefile()!;
	gamefile.startSnapshot.slidingPossible.forEach((slide: Vec2) => { // For each slide direction in the game...
		const slideKey = math.getKeyFromVec2(slide);

		// Find the 2 points on opposite sides of the bounding box
		// that will contain all organized lines of the given vector
		// intersecting the box between them.

		const containingPoints = math.findFarthestPointsALineSweepsABox(slide, boundingBoxInt);
		const containingPointsLineC = containingPoints.map(point => math.getLineCFromCoordsAndVec(point, slide)) as [number, number];
		// Any line of this slope of which its C value is not within these 2 are outside of our screen,
		// so no arrows will be visible for the piece.
		containingPointsLineC.sort((a, b) => a - b); // Sort them so C is ascending. Then index 0 will be the minimum and 1 will be the max.

		// For all our lines in the game with this slope...
		const organizedLinesOfDir = gamefile.piecesOrganizedByLines[slideKey];
		for (const lineKey of Object.keys(organizedLinesOfDir)) {
			// The C of the lineKey (`C|X`) with this slide at the very left & right sides of the screen.
			const C = organizedlines.getCFromKey(lineKey as LineKey);
			if (C < containingPointsLineC[0] || C > containingPointsLineC[1]) continue; // Next line, this one is off-screen, so no piece arrows are visible
			const organizedLine = organizedLinesOfDir[lineKey]!;
			// Calculate the ACTUAL arrows that should be visible for this specific organized line.
			const arrowsLine = calcArrowsLine(gamefile, boundingBoxInt, boundingBoxFloat, slide, slideKey, organizedLine as Piece[], lineKey as LineKey);
			// If it is empty, don't add it.
			if (arrowsLine.negDotProd.length === 0 && arrowsLine.posDotProd.length === 0) continue;
			if (!slideArrows[slideKey]) slideArrows[slideKey] = {}; // Make sure this exists first
			slideArrows[slideKey][lineKey] = arrowsLine; // Add this arrows line to our object containing all arrows for this frame
		}
	});

	return slideArrows;
}

/**
 * Calculates what arrows should be visible for a single
 * organized line of pieces intersecting our screen.
 * 
 * If the game contains ANY custom blocking functions, which would be true if we were
 * using the Huygens, then there could be a single arrow pointing to multiple pieces,
 * since the Huygens can phase through / skip over other pieces.
 */
function calcArrowsLine(gamefile: gamefile, boundingBoxInt: BoundingBox, boundingBoxFloat: BoundingBox, slideDir: Vec2, slideKey: Vec2Key, organizedline: Piece[], lineKey: LineKey): ArrowsLineDraft {

	const negDotProd: Entry[] = [];
	const posDotProd: Entry[] = [];

	let closestNegDotProd: Entry | undefined;
	let closestRightDotProd: Entry  | undefined;

	const axis = slideDir[0] === 0 ? 1 : 0;
	organizedline.forEach(piece => {
		// Is the piece off-screen?
		if (math.boxContainsSquare(boundingBoxInt, piece.coords)) return; // On-screen, no arrow needed

		// Piece is guaranteed off-screen...
		
		const intersectionCoords = math.findLineBoxIntersections(piece.coords, slideDir, boundingBoxInt);
		if (intersectionCoords.length < 2) return; // Likely intersects perfectly on a corner
		const positiveDotProduct = intersectionCoords[0]!.positiveDotProduct;

		const entry = { piece, canSlideOntoScreen: false };

		if (positiveDotProduct) {
			if (closestNegDotProd === undefined) closestNegDotProd = entry;
			else if (piece.coords[axis] > closestNegDotProd.piece.coords[axis]) closestNegDotProd = entry;
		} else {
			if (closestRightDotProd === undefined) closestRightDotProd = entry;
			else if (piece.coords[axis] < closestRightDotProd.piece.coords[axis]) closestRightDotProd = entry;
		}

		// Game is using atleast one custom blocking function...

		/**
		 * Calculate it's maximum slide.
		 * If it is able to slide (ignoring ignore function, and ignoring check respection)
		 * into our screen area, then it should be guaranteed an arrow,
		 * EVEN if it's not the closest piece to us on the line
		 * (which would mean it phased/skipped over pieces due to a custom blocking function)
		 */

		const slideLegalLimit = legalmoves.calcPiecesLegalSlideLimitOnSpecificLine(gamefile, piece, slideDir, slideKey, lineKey, organizedline);
		if (slideLegalLimit === undefined) return; // This piece can't slide along the direction of travel

		// It CAN slide along our direction of travel...
		// But can it slide far enough where it can reach our screen?

		// First of all, what are the intersection coordinates of its slide
		// on our screen?

		// Next, how do find out if it's legal slide protrudes into the screen?

		if (intersectionCoords.length < 2) return; // Probably intersects the screen box exactly on the corner
		// If the vector is in the opposite direction, then the first intersection is swapped
		const firstIntersection = positiveDotProduct ? intersectionCoords[0]! : intersectionCoords[1]!;

		// What is the distance to the first intersection point?

		const firstIntersectionDist = math.chebyshevDistance(piece.coords, firstIntersection.coords);
		// What is the distance to the farthest point this piece can slide along this direction?
		let farthestSlidePoint: Coords = firstIntersection.positiveDotProduct ? [
			piece.coords[0] + slideDir[0] * slideLegalLimit[1],
			piece.coords[1] + slideDir[1] * slideLegalLimit[1],
		] : [ // Negative dot product
			piece.coords[0] - slideDir[0] * slideLegalLimit[0],
			piece.coords[1] - slideDir[1] * slideLegalLimit[0],
		];
		// NaNs may occur if zero is multiplied by infinity. Make sure we replace each of those with zero.
		// (but it doesn't matter whether we replace it with zero, a finite number, or infinity, because
		// the chebyshev distance is gonna be infinity anyway, since the other coord is infinity)
		farthestSlidePoint = farthestSlidePoint.map(coord => isNaN(coord) ? 0 : coord) as Coords;
		const farthestSlidePointDist = math.chebyshevDistance(piece.coords, farthestSlidePoint);

		// If the farthest slide point distance is greater than the first intersection
		// distance, then the piece is able to slide into the screen bounding box!

		if (farthestSlidePointDist < firstIntersectionDist) return; // This piece cannot slide so far as to intersect the screen bounding box

		// This piece CAN slide far enough to enter our screen...

		entry.canSlideOntoScreen = true;

		if (positiveDotProduct) {
			const boundingBoxSide = axis === 0 ? boundingBoxInt.left : boundingBoxInt.bottom;
			if (slideLegalLimit[1] > boundingBoxSide) negDotProd.push(entry); // Can reach our screen
		} else { // Opposite side
			const boundingBoxSide = axis === 0 ? boundingBoxInt.right : boundingBoxInt.top;
			if (slideLegalLimit[0] < boundingBoxSide) posDotProd.push(entry); // Can reach our screen
		}
	});

	// Add the closest left/right pieces if they haven't been added already
	if (closestNegDotProd !== undefined && !negDotProd.includes(closestNegDotProd)) negDotProd.push(closestNegDotProd);
	if (closestRightDotProd !== undefined && !posDotProd.includes(closestRightDotProd)) posDotProd.push(closestRightDotProd);

	// Now sort them.
	negDotProd.sort((entry1, entry2) => entry1.piece.coords[axis] - entry2.piece.coords[axis]);
	posDotProd.sort((entry1, entry2) => entry2.piece.coords[axis] - entry1.piece.coords[axis]);
	// console.log(`Sorted left & right arrays of line of arrows for slideDir ${JSON.stringify(slideDir)}, lineKey ${lineKey}:`);
	// console.log(left);
	// console.log(right);

	return { negDotProd, posDotProd };
}

/**
 * Removes arrows based on the mode.
 * mode == 1 Removes arrows to only include pieces that can slide in that direction (which may include hippogonals)
 * mode == 2 Everything in mode 1, PLUS all orthogonals and diagonals, whether or not the piece can slide in that direction
 * mode == 3 Everything in mode 1 & 2, PLUS all hippogonals, whether or not the piece can slide in that direction
 */
function removeUnnecessaryArrows(slideArrows: SlideArrowsDraft) {
	const gamefile = gameslot.getGamefile()!;
	if (mode === 3) return; // Don't remove anything

	let slideExceptions: Vec2Key[] = [];
	// If we're in mode 2, retain all orthogonals and diagonals, EVEN if they can't slide in that direction.
	if (mode === 2) {
		slideExceptions = gamefile.startSnapshot.slidingPossible.filter((slideDir: Vec2) => Math.max(Math.abs(slideDir[0]), Math.abs(slideDir[1])) === 1).map(math.getKeyFromVec2);
	}

	for (const direction in slideArrows) {
		if (slideExceptions.includes(direction as Vec2Key)) continue; // Keep it anyway, our arrows mode is high enough
		removeTypesThatCantSlideOntoScreen(slideArrows[direction as Vec2Key]!);
		if (jsutil.isEmpty(slideArrows[direction as Vec2Key]!)) delete slideArrows[direction as Vec2Key];
	}

	function removeTypesThatCantSlideOntoScreen(object: { [lineKey: LineKey]: ArrowsLineDraft }) { // horzRight, vertical/diagonalUp
		for (const key in object) { // LineKey
			const line: ArrowsLineDraft = object[key as LineKey]!;
			if (line.negDotProd.length > 0) {
				const entry: Entry = line.negDotProd[line.negDotProd.length - 1]!;
				if (!entry.canSlideOntoScreen) line.negDotProd.pop();
			}
			if (line.posDotProd.length > 0) {
				const entry: Entry = line.posDotProd[line.posDotProd.length - 1]!;
				if (!entry.canSlideOntoScreen) line.posDotProd.pop();
			}
			if (line.negDotProd.length === 0 && line.posDotProd.length === 0) delete object[key as LineKey];
		}
	}
}

/**
 * Calculates the world space coordinate of each arrow on screen,
 * the piece type,
 * the direction the arrow points,
 * the piece the arrow points to,
 * and constructs a list of all ARROWS (not pieces) being hovered over.
 */
function calculateInstanceData_AndArrowsHovered(slideArrowsDraft: SlideArrowsDraft, boundingBoxFloat: BoundingBox) {

	/**
	 * A running list of of piece arrows being hovered over this frame
	 * The ARROW, not the piece which the arrow is pointing to.
	 */
	if (Object.keys(slideArrows).length > 0) throw Error('SHOULD have erased all slide arrows before recalcing'); // DELETE LATER


	const worldWidth = width * movement.getBoardScale(); // The world-space width of our images
	const worldHalfWidth = worldWidth / 2;

	const mouseWorldLocation = input.getTouchClickedWorld() ? input.getTouchClickedWorld() : input.getMouseWorldLocation();

	// for (const vec2Key in slideArrowsDraft) {
	// 	const arrowLinesOfSlideDir = slideArrowsDraft[vec2Key as Vec2Key]!;
	// 	const slideDir = math.getVec2FromKey(vec2Key as Vec2Key);
	// 	for (const lineKey in arrowLinesOfSlideDir) { // `C|X`
	// 		arrowLinesOfSlideDir[lineKey]!.negDotProd.forEach((entry, index) => processPiece(vec2Key as Vec2Key, lineKey as LineKey, entry.piece, index, slideDir, true));
	// 		arrowLinesOfSlideDir[lineKey]!.posDotProd.forEach((entry, index) => processPiece(vec2Key as Vec2Key, lineKey as LineKey, entry.piece, index, slideDir, false));
	// 	}
	// }

	// Take the arrows draft, construct the actual
	for (const [vec2Key, slideDraft] of Object.entries(slideArrowsDraft)) {
		const slide: { [lineKey: string]: ArrowsLine } = slideArrows[vec2Key] = {};
		for (const [lineKey, arrowLineDraft] of Object.entries(slideDraft)) {
			const posDotProd = arrowLineDraft.map(entry => processPiece(vec2Key, entry))
			slide[lineKey] = { posDotProd, negDotProd };
		}
	}


	// Calculates the world space center of the picture of the arrow, and tests if the mouse is hovering over.
	// Adds the arrow the the FINAL arrows, not the drafts.
	function processPiece(lineKey: LineKey, piece: Piece, index: number, slideDir: Vec2, posDotProd: boolean): Arrow {
		if (piece.type === 'voidsN') return;
		const vector = posDotProd ? slideDir : math.negateVector(slideDir);
		const boxIntersections = math.findLineBoxIntersections(piece.coords, vector, boundingBoxFloat);
		if (boxIntersections.length < 2) return; // Probably perfectly intersects a corner
		// If the intersections are in the opposite direction the vector's pointing, then the first intersection is swapped
		const firstIntersection = boxIntersections[1]!.positiveDotProduct ? boxIntersections[0]! : boxIntersections[1]!;
		const renderCoords = firstIntersection.coords;
		
		// If this picture is an adjacent picture, adjust it's positioning
		let isAdjacent = false;
		if (index > 0) {
			isAdjacent = true;
			renderCoords[0] += vector[0] * paddingBetwAdjacentPictures * index;
			renderCoords[1] += vector[1] * paddingBetwAdjacentPictures * index;
		}

		const worldLocation: Coords = space.convertCoordToWorldSpace(renderCoords) as Coords;

		// Does the mouse hover over the piece?
		let hovered = false;
		const chebyshevDist = math.chebyshevDistance(worldLocation, mouseWorldLocation);
		if (chebyshevDist < worldHalfWidth) { // Mouse inside the picture bounding box
			hovered = true;
			// ADD the piece to the list of arrows being hovered over!!!
			hoveredArrows.push({ piece });
			
			// If we also clicked, then teleport!
			if (input.isMouseDown_Left() || input.getTouchClicked()) {

				// Teleport in the direction of the piece's arrow, NOT straight to the piece.

				const startCoords = movement.getBoardPos();
				// The direction we will follow when teleporting
				const line1GeneralForm = math.getLineGeneralFormFromCoordsAndVec(startCoords, slideDir);
				// The line perpendicular to the target piece
				const perpendicularSlideDir: Vec2 = [-slideDir[1], slideDir[0]]; // Rotates left 90deg
				const line2GeneralForm = math.getLineGeneralFormFromCoordsAndVec(piece.coords, perpendicularSlideDir);
				// The target teleport coords
				const telCoords = math.calcIntersectionPointOfLines(...line1GeneralForm, ...line2GeneralForm)!; // We know it will be defined because they are PERPENDICULAR

				transition.panTel(startCoords, telCoords);
				if (input.isMouseDown_Left()) input.removeMouseDown_Left();
			}
		}

		return { worldLocation, piece, hovered, };

		// arrowsData.push({ worldLocation, type: piece.type, slideDir, flipped: !posDotProd, hovered, isAdjacent });
	}

	// console.log("Arrows hovered over this frame:");
	// console.log(hoveredArrows);

	// console.log("Arrows instance data calculated this frame:");
	// console.log(arrowsData);
}














function addArrow(piece: Piece) {

}



/**
 * 
 * @param coords - The coordinates of the piece to delete.
 * @param recalcHover - Whether, on the line affected by the removed piece, to recalculate if the mouse is hovering their new positions, and teleport if they were clicked.
 * This should be true if the piece being removed is the piece currently being animated,
 * but false if the piece being removed is being captured by a drag-drop.
 */
function removeArrow(coords: Coords, recalcHover: boolean) {

}














function render() {
	updateLegalMovesOfHoveredPieces();
	regenerateModelAndRender();
}

function regenerateModelAndRender() {
	if (arrowsData.length === 0) return; // No visible arrows, don't generate the model

	const data: number[] = [];
	const dataArrows: number[] = [];

	// ADD THE DATA
	// ...

	const worldWidth = width * movement.getBoardScale(); // The world-space width of our images
	const halfWorldWidh = worldWidth / 2;

	arrowsData.forEach(arrow => concatData(data, dataArrows, arrow, worldWidth, halfWorldWidh));

	/** The buffer model of the piece mini images on
	 * the edge of the screen. **Doesn't include** the little arrows. */
	const modelPictures = createModel(data, 2, "TRIANGLES", true, spritesheet.getSpritesheet());
	/** The buffer model of the little arrows on
	 * the edge of the screen next to the mini piece images. */
	const modelArrows = createModel(dataArrows, 2, "TRIANGLES", true);

	modelPictures.render();
	modelArrows.render();

	// Reset lists for next frame
	slideArrows = {};
	hoveredArrows.length = 0;
}

/**
 * This makes sure that the legal moves of all of the hovered arrows this
 * frame are already calculated.
 * 
 * Pieces that are consecutively hovered over each frame have their
 * legal moves cached.
 */
function updateLegalMovesOfHoveredPieces() {
	const gamefile = gameslot.getGamefile()!;

	// Do not render line highlights upon arrow hover, when game is rewinded,
	// since calculating their legal moves means overwriting game's move history.
	if (!moveutil.areWeViewingLatestMove(gamefile)) {
		hoveredArrowsLegalMoves.length = 0;
		return;
	}

	// Iterate through all pieces in piecesHoveredOver, if they aren't being
	// hovered over anymore, delete them. Stop rendering their legal moves. 
	for (let i = hoveredArrowsLegalMoves.length - 1; i >= 0; i--) { // Iterate backwards because we are removing elements as we go
		const thisHoveredArrow = hoveredArrowsLegalMoves[i]!;
		// Is this arrow still being hovered over?
		if (!hoveredArrows.some(arrow => arrow.piece.coords === thisHoveredArrow.piece.coords)) hoveredArrowsLegalMoves.splice(i, 1); // No longer being hovered over
	}

	for (const pieceHovered of hoveredArrows) {
		onPieceIndicatorHover(pieceHovered.piece); // Generate their legal moves and highlight model
	}
}

/**
 * Call when a piece's arrow is hovered over.
 * Calculates their legal moves and model for rendering them.
 * @param piece - The piece this arrow is pointing to
 */
function onPieceIndicatorHover(piece: Piece) {

	// Check if their legal moves and mesh have already been stored
	// TODO: Make sure this is still often called
	if (hoveredArrowsLegalMoves.some(hoveredArrow => hoveredArrow.piece.coords === piece.coords)) return; // Legal moves and mesh already calculated.

	// Calculate their legal moves and mesh!
	const gamefile = gameslot.getGamefile()!;
	const thisRider = gamefileutility.getPieceAtCoords(gamefile, piece.coords)!;
	const thisPieceLegalMoves = legalmoves.calculate(gamefile, thisRider);

	// Calculate the mesh...

	// Determine what color the legal move highlights should be...
	const pieceColor = colorutil.getPieceColorFromType(piece.type);
	const opponentColor = onlinegame.areInOnlineGame() ? colorutil.getOppositeColor(onlinegame.getOurColor()) : colorutil.getOppositeColor(gamefile.whosTurn);
	const isOpponentPiece = pieceColor === opponentColor;
	const isOurTurn = gamefile.whosTurn === pieceColor;
	const color = options.getLegalMoveHighlightColor({ isOpponentPiece, isPremove: !isOurTurn });

	const { NonCaptureModel, CaptureModel } = legalmovehighlights.generateModelsForPiecesLegalMoveHighlights(piece.coords, thisPieceLegalMoves, color);
	// Store both these objects inside piecesHoveredOver
	hoveredArrowsLegalMoves.push({ piece, legalMoves: thisPieceLegalMoves, model_NonCapture: NonCaptureModel, model_Capture: CaptureModel, color });
}

/**
 * Takes an arrow, generates the vertex data of both the PICTURE and ARROW,
 * and appends them to their respective vertex data arrays.
 * */
function concatData(data: number[], dataArrows: number[], arrow: Arrow, worldWidth: number, halfWorldWidth: number) {

	const rotation = perspective.getIsViewingBlackPerspective() ? -1 : 1;
	const { texleft, texbottom, texright, textop } = bufferdata.getTexDataOfType(arrow.type, rotation);

	// I DONT THINK this padding needs to be added here because it should be
	// added into the instance data inside update()
	// const xPad = paddingDir.includes('right') ? -padding
	//             : paddingDir.includes('left')  ?  padding
	//             : 0;

	// const yPad = paddingDir.includes('top')          ? -padding
	//             : paddingDir.includes('bottom')       ?  padding
	//             : 0;

	// worldLocation[0] += xPad;
	// worldLocation[1] += yPad;

	const startX = arrow.worldLocation[0] - halfWorldWidth;   
	const startY = arrow.worldLocation[1] - halfWorldWidth;
	const endX = startX + worldWidth;
	const endY = startY + worldWidth;

	// Color
	const { r, g, b } = options.getColorOfType(arrow.type);
	// Are we hovering over? If so, opacity needs to be 100%
	const a = arrow.hovered ? 1 : opacity;

	// Opacity changing with distance
	// let maxAxisDist = math.chebyshevDistance(movement.getBoardPos(), pieceCoords) - 8;
	// opacity = Math.sin(maxAxisDist / 40) * 0.5

	const thisData = bufferdata.getDataQuad_ColorTexture(startX, startY, endX, endY, texleft, texbottom, texright, textop, r, g, b, a);

	data.push(...thisData);

	// Next append the data of the little arrow!

	if (arrow.isAdjacent) return; // We can skip, since it is an adjacent picture!

	const dist = halfWorldWidth * 1;
	const size = 0.3 * halfWorldWidth;
	const points: Coords[] = [
        [dist, -size],
        [dist, +size],
        [dist + size, 0]
    ];

	const arrowDir = arrow.flipped ? arrow.slideDir : math.negateVector(arrow.slideDir);
	const angle = Math.atan2(arrowDir[1], arrowDir[0]);
	const ad = applyTransform(points, angle, arrow.worldLocation);

	for (let i = 0; i < ad.length; i++) {
		const thisPoint = ad[i]!;
		//                   x             y          color
		dataArrows.push(thisPoint[0], thisPoint[1], 0,0,0,a );
	}
}

/**
 * Applies a rotational & translational transformation to an array of points.
 * 
 * TODO: Move to maybe bufferdata?
 */
function applyTransform(points: Coords[], rotation: number, translation: Coords): Coords[] {
	// convert rotation angle to radians
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
    
	// apply rotation matrix and translation vector to each point
	const transformedPoints: Coords[] = points.map(point => {
		const xRot = point[0] * cos - point[1] * sin;
		const yRot = point[0] * sin + point[1] * cos;
		const xTrans = xRot + translation[0];
		const yTrans = yRot + translation[1];
		return [xTrans, yTrans];
	});
    
	// return transformed points as an array of length-2 arrays
	return transformedPoints;
}








function renderEachHoveredPieceLegalMoves() {
	if (hoveredArrowsLegalMoves.length === 0) return; // No legal moves to render

	const boardPos = movement.getBoardPos();
	const model_Offset = legalmovehighlights.getOffset();
	const position: [number,number,number] = [
        -boardPos[0] + model_Offset[0], // Add the highlights offset
        -boardPos[1] + model_Offset[1],
        0
    ];
	const boardScale = movement.getBoardScale();
	const scale: [number,number,number] = [boardScale, boardScale, 1];

	hoveredArrowsLegalMoves.forEach(hoveredArrow => {
		// Skip it if the piece being hovered over IS the piece selected! (Its legal moves are already being rendered)
		if (selection.isAPieceSelected()) {
			const pieceSelectedCoords = selection.getPieceSelected()!.coords;
			if (coordutil.areCoordsEqual_noValidate(hoveredArrow.piece.coords, pieceSelectedCoords)) return; // Skip (already rendering its legal moves, because it's selected)
		}
		hoveredArrow.model_NonCapture.render(position, scale);
		hoveredArrow.model_Capture.render(position, scale);
	});
}

/**
 * Call when our highlights offset, or render range bounding box, changes.
 * This regenerates the mesh of the piece arrow indicators hovered
 * over to account for the new offset.
 */
function regenModelsOfHoveredPieces() {
	if (hoveredArrowsLegalMoves.length === 0) return; // No arrows being hovered over

	console.log("Updating models of hovered piece's legal moves..");

	hoveredArrowsLegalMoves.forEach(hoveredArrow => {
		// Calculate the mesh...
		const { NonCaptureModel, CaptureModel } = legalmovehighlights.generateModelsForPiecesLegalMoveHighlights(hoveredArrow.piece.coords, hoveredArrow.legalMoves, hoveredArrow.color);
		// Overwrite the model inside piecesHoveredOver
		hoveredArrow.model_NonCapture = NonCaptureModel;
		hoveredArrow.model_Capture = CaptureModel;
	});
}

/**
 * Erases the list of piece arrows the mouse is currently hovering over & rendering legal moves for.
 * This is typically called when a move is made in-game, so that the arrows' legal moves don't leak from move to move.
 */
function clearListOfHoveredPieces() {
	hoveredArrowsLegalMoves.length = 0;
}

export default {
	getMode,
	setMode,
	toggleArrows,
	
	update,
	render,
	renderEachHoveredPieceLegalMoves,
	regenModelsOfHoveredPieces,
	clearListOfHoveredPieces
};
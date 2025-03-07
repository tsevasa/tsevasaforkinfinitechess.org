
/**
 * This script updates the checkmates_beaten list in the database when a user submits a newly completed checkmate
 */

// @ts-ignore
import { logEvents } from "../middleware/logEvents.js";
// @ts-ignore
import { getMemberDataByCriteria, updateCheckmatesBeaten } from '../database/memberManager.js';


import type { CustomRequest } from "../../types.js";
import type { Response } from "express";


// Functions -------------------------------------------------------------

/**
 * Sets the checkmates_beaten cookie for the user.
 * @param {Object} res - The Express response object.
 * @param {Object} checkmates_beaten - The checkmates_beaten object to be saved in the cookie.
 */
function createPracticeProgressCookie(res: Response, checkmates_beaten: string) {
	// Set or update the checkmates_beaten cookie
	res.cookie('checkmates_beaten', checkmates_beaten, {
		httpOnly: false,
		secure: true,
	});
}

/**
 * Deletes the checkmates_beaten progress cookie for the user.
 * Typically called when they log out.
 * Even though the cookie only lasts 10 seconds, this is still helpful
 * @param {Object} res - The Express response object.
 */
function deletePracticeProgressCookie(res: Response) {
	res.clearCookie('checkmates_beaten', {
		httpOnly: false,
		secure: true,
	});
}

/**
 * Fetches the checkmates_beaten for a given user from the database.
 * @param {number} userId - The ID of the user whose checkmates_beaten are to be fetched.
 * @returns {string} - Returns the checkmates_beaten object if found, otherwise undefined.
 */
function getCheckmatesBeaten(userId: number): string {
	const { checkmates_beaten } = getMemberDataByCriteria(['checkmates_beaten'], 'user_id', userId, { skipErrorLogging: true });
	return checkmates_beaten;
}

/**
 * Route that Handles a POST request to update user checkmates_beaten in the database.
 * @param {CustomRequest} req - Express request object
 * @param {Response} res - Express response object
 */
async function postCheckmateBeaten(req: CustomRequest, res: Response) {
	if (!req.memberInfo) { // { user_id, username, roles }
		logEvents("Can't save user checkmates_beaten when req.memberInfo is not defined yet! Move this route below verifyJWT.", 'errLog.txt', { print: true });
		return res.status(500).json({ message: "Server Error: No Authorization"});
	}

	if (!req.memberInfo.signedIn) {
		logEvents("User tried to save checkmates_beaten when they weren't signed in!", 'errLog.txt', { print: true });
		return res.status(401).json({ message: "Can't save checkmates_beaten, not signed in."});
	}

	const { user_id, username } = req.memberInfo;

	const new_checkmate_beaten = req.body.new_checkmate_beaten;

	// This method updates the checkmates_beaten entry in the database, if applicable, and returns the new checkmates_beaten string:
	const checkmates_beaten = updateCheckmatesBeaten(user_id, new_checkmate_beaten);

	// Send appropriate response
	if (checkmates_beaten) {
		console.log(`Successfully interacted with checkmate list of "${username}" of id "${user_id}".`);
		// Create a new cookie with an updated checkmate list for the user
		createPracticeProgressCookie(res, checkmates_beaten as string);
		return res.status(200).json({ message: 'Serverside practice checkmate list interaction successful' });
	} else {
		logEvents(`Failed to save practice checkmate for member "${username}" id "${user_id}". No lines changed. Do they exist?`, 'errLog.txt', { print: true });
		return res.status(500).json({ message: 'Failed to update serverside practice checkmate: user_id not found' });
	}
}

export {
	createPracticeProgressCookie,
	deletePracticeProgressCookie,
	getCheckmatesBeaten,
	postCheckmateBeaten
};
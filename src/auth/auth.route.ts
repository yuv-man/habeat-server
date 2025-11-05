import express from 'express';
import { registerUser, loginUser, logoutUser, googleSignup, googleSignin, facebookSignup, facebookSignin, getUser } from './auth.controller';
import { RequestHandler } from 'express';

const router = express.Router();

router.post('/signup', registerUser as RequestHandler);
router.post('/login', loginUser as RequestHandler);
router.post('/logout', logoutUser as RequestHandler);
router.get('/users/me', getUser as RequestHandler);

// OAuth routes
router.post('/google/signup', googleSignup as RequestHandler);
router.post('/google/signin', googleSignin as RequestHandler);
router.post('/facebook/signup', facebookSignup as RequestHandler);
router.post('/facebook/signin', facebookSignin as RequestHandler);

export default router;
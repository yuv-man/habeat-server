import { User } from '../user/user.model';
import generateToken from '../utils/generateToken';
import logger from '../utils/logger';
import { Request, Response } from 'express';
import { IUserData } from '../types/interfaces';
import { verifyGoogleToken, verifyFacebookToken, generateOAuthPassword } from '../utils/oauth';
import { createInitialPlanFunction } from '../plan/plan.service';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types/interfaces';
import { Plan } from '../plan/plan.model';

// @desc    Register a new user
// @route   POST /auth/signup
// @access  Public
const registerUser = async (req: Request, res: Response) => {
  try {
    const data: {email: string, password: string, userData: IUserData} = req.body;
    
    // Check if user already exists
    const userExists = await User.findOne({ email: data.email });
    
    if (userExists) {
      return res.status(400).json({
        status: 'fail',
        message: 'User already exists'
      });
    }
    
    // Create new user
    const user = await User.create({
      ...data.userData,
    });

    const initialPlan = await createInitialPlanFunction(user._id.toString(), data.userData, 'en');
    
    if (user) {
      res.status(201).json({
        status: 'success',
        data: {
          user: user,
          plan: initialPlan,
          token: generateToken(user._id.toString())
        }
      });
    } else {
      res.status(400).json({
        status: 'fail',
        message: 'Invalid user data'
      });
    }
  } catch (error) {
    logger.error('Error registering user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
};

// @desc    Auth user & get token
// @route   POST /auth/login
// @access  Public
const loginUser = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    
    // Check if user exists and password is correct
    if (user && user.comparePassword && await user.comparePassword(password)) {
      res.json({
        status: 'success',
        data: {
          user: user,
          token: generateToken(user._id.toString())
        }
      });
    } else {
      res.status(401).json({
        status: 'fail',
        message: 'Invalid email or password'
      });
    }
  } catch (error) {
    logger.error('Error logging in user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
};

// @desc    Logout user
// @route   POST /auth/logout
// @access  Private
const logoutUser = async (req: Request, res: Response) => {
  try {
    res.json({
      status: 'success',
      message: 'Logged out successfully'
    });
  } catch (error) {
    logger.error('Error logging out user:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
};

// @desc    Google OAuth signup - Create new user
// @route   POST /auth/google/signup
// @access  Public
const googleSignup = async (req: Request, res: Response) => {
  try {
    const { idToken, userData } = req.body;

    if (!idToken) {
      return res.status(400).json({
        status: 'fail',
        message: 'Google ID token is required'
      });
    }

    // Verify Google ID token
    const googleUser = await verifyGoogleToken(idToken);
    
    if (!googleUser) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid Google token'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: googleUser.email });
    
    if (existingUser) {
      return res.status(400).json({
        status: 'fail',
        message: 'User already exists. Please use sign in instead.'
      });
    }

    // Create new user from Google data
    const user = await User.create({
      email: googleUser.email,
      name: userData?.name || `${googleUser.given_name || ''} ${googleUser.family_name || ''}`.trim() || 'User',
      password: generateOAuthPassword('google'),
      age: userData?.age || 25,
      gender: userData?.gender || 'male',
      height: userData?.height || 170,
      weight: userData?.weight || 70,
      activityLevel: userData?.activityLevel || 'moderate',
      path: userData?.path || 'healthy',
      targetWeight: userData?.targetWeight,
      allergies: userData?.allergies || [],
      dietaryRestrictions: userData?.dietaryRestrictions || [],
      favoriteMeals: userData?.favoriteMeals || [],
      picture: googleUser.picture,
      oauthProvider: 'google',
      oauthId: googleUser.sub
    });

    // Create initial plan for new user
    const userDataForPlan: IUserData = {
      email: user.email,
      password: user.password,
      name: user.name,
      age: user.age,
      gender: user.gender,
      height: user.height,
      weight: user.weight,
      activityLevel: user.activityLevel,
      path: user.path,
      targetWeight: user.targetWeight,
      allergies: user.allergies,
      dietaryRestrictions: user.dietaryRestrictions,
      favoriteMeals: user.favoriteMeals,
      preferences: {}
    };

    const initialPlan = await createInitialPlanFunction(user._id.toString(), userDataForPlan, 'en');

    res.status(201).json({
      token: generateToken(user._id.toString()),
      user: user
    });

  } catch (error) {
    logger.error('Error with Google OAuth signup:', error);
    res.status(500).json({
      status: 'error',
      message: 'Google signup failed'
    });
  }
};

// @desc    Google OAuth signin - Get existing user
// @route   POST /auth/google/signin
// @access  Public
const googleSignin = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        status: 'fail',
        message: 'Google ID token is required'
      });
    }

    // Verify Google ID token
    const googleUser = await verifyGoogleToken(idToken);
    
    if (!googleUser) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid Google token'
      });
    }

    // Find existing user
    const user = await User.findOne({ email: googleUser.email });

    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found. Please sign up first.'
      });
    }

    // Update OAuth info for existing user
    user.oauthProvider = 'google';
    user.oauthId = googleUser.sub;
    if (googleUser.picture && !user.picture) {
      user.picture = googleUser.picture;
    }
    await user.save();

    // Get user's plan
    const plan = await Plan.findOne({ userId: user._id });

    res.json({
      token: generateToken(user._id.toString()),
      user: user
    });

  } catch (error) {
    logger.error('Error with Google OAuth signin:', error);
    res.status(500).json({
      status: 'error',
      message: 'Google signin failed'
    });
  }
};

// @desc    Facebook OAuth signup - Create new user
// @route   POST /auth/facebook/signup
// @access  Public
const facebookSignup = async (req: Request, res: Response) => {
  try {
    const { accessToken, userData } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        status: 'fail',
        message: 'Facebook access token is required'
      });
    }

    // Verify Facebook access token
    const facebookUser = await verifyFacebookToken(accessToken);
    
    if (!facebookUser) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid Facebook token'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: facebookUser.email });
    
    if (existingUser) {
      return res.status(400).json({
        status: 'fail',
        message: 'User already exists. Please use sign in instead.'
      });
    }

    // Create new user from Facebook data
    const user = await User.create({
      email: facebookUser.email,
      name: userData?.name || `${facebookUser.first_name || ''} ${facebookUser.last_name || ''}`.trim() || 'User',
      password: generateOAuthPassword('facebook'),
      age: userData?.age || 25,
      gender: userData?.gender || 'male',
      height: userData?.height || 170,
      weight: userData?.weight || 70,
      activityLevel: userData?.activityLevel || 'moderate',
      path: userData?.path || 'healthy',
      targetWeight: userData?.targetWeight,
      allergies: userData?.allergies || [],
      dietaryRestrictions: userData?.dietaryRestrictions || [],
      favoriteMeals: userData?.favoriteMeals || [],
      picture: facebookUser.picture,
      oauthProvider: 'facebook',
      oauthId: facebookUser.id
    });

    // Create initial plan for new user
    const userDataForPlan: IUserData = {
      email: user.email,
      password: user.password,
      name: user.name,
      age: user.age,
      gender: user.gender,
      height: user.height,
      weight: user.weight,
      activityLevel: user.activityLevel,
      path: user.path,
      targetWeight: user.targetWeight,
      allergies: user.allergies,
      dietaryRestrictions: user.dietaryRestrictions,
      favoriteMeals: user.favoriteMeals,
      preferences: {}
    };

    const initialPlan = await createInitialPlanFunction(user._id.toString(), userDataForPlan, 'en');

    res.status(201).json({
      token: generateToken(user._id.toString()),
      user: user
    });

  } catch (error) {
    logger.error('Error with Facebook OAuth signup:', error);
    res.status(500).json({
      status: 'error',
      message: 'Facebook signup failed'
    });
  }
};

// @desc    Facebook OAuth signin - Get existing user
// @route   POST /auth/facebook/signin
// @access  Public
const facebookSignin = async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        status: 'fail',
        message: 'Facebook access token is required'
      });
    }

    // Verify Facebook access token
    const facebookUser = await verifyFacebookToken(accessToken);
    
    if (!facebookUser) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid Facebook token'
      });
    }

    // Find existing user
    const user = await User.findOne({ email: facebookUser.email });

    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found. Please sign up first.'
      });
    }

    // Update OAuth info for existing user
    user.oauthProvider = 'facebook';
    user.oauthId = facebookUser.id;
    if (facebookUser.picture && !user.picture) {
      user.picture = facebookUser.picture;
    }
    await user.save();

    // Get user's plan (optional, not required for signin)
    const plan = await Plan.findOne({ userId: user._id });

    res.json({
      token: generateToken(user._id.toString()),
      user: user
    });

  } catch (error) {
    logger.error('Error with Facebook OAuth signin:', error);
    res.status(500).json({
      status: 'error',
      message: 'Facebook signin failed'
    });
  }
};

const getUser = async (req: Request, res: Response) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      const token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as JwtPayload;
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(401).json({
          status: 'fail',
          message: 'Unauthorized'
        });
      }
      const plan = await Plan.findOne({ userId: user._id });
      if (!plan) {
        return res.status(401).json({
          status: 'fail',
          message: 'Unauthorized'
        });
      }
      res.json({
        status: 'success',
        data: {
          user: user,
          plan: plan
        }
      });
    } catch (error) {
      res.status(401).json({
        status: 'fail',
        message: 'Unauthorized'
      });
    }
  }
};

export { registerUser, loginUser, logoutUser, googleSignup, googleSignin, facebookSignup, facebookSignin, getUser };
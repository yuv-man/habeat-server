import jwt from 'jsonwebtoken';
import { User } from '../user/user.model';
import logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from '../types/interfaces';


// Extend Request interface to include user property
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const protect = async (req: Request, res: Response, next: NextFunction) => {
  let token;
  
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];
      
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as JwtPayload;
      
      // Get user from the token
      req.user = await User.findById(decoded.id).select('-password');
      
      next();
    } catch (error) {
      logger.error('Auth middleware error:', error);
      res.status(401).json({
        status: 'fail',
        message: 'Not authorized, token failed'
      });
    }
  }
  
  if (!token) {
    res.status(401).json({
      status: 'fail',
      message: 'Not authorized, no token'
    });
  }
};

export { protect };
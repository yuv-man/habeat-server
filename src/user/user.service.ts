import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User } from "./user.model";
import { Meal } from "../meal/meal.model";
import logger from "../utils/logger";
import mongoose from "mongoose";
import { IUserData, IMeal } from "../types/interfaces";

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<IUserData>,
    @InjectModel(Meal.name) private mealModel: Model<IMeal>
  ) {}

  async findAll() {
    return this.userModel.find().lean().exec();
  }

  async create(userData: any) {
    return this.userModel.create(userData);
  }

  async search(searchCriteria: any) {
    return this.userModel.find(searchCriteria).lean().exec();
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id).lean().exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async update(id: string, updateData: any) {
    const user = await this.userModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .lean()
      .exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async delete(id: string) {
    const user = await this.userModel.findByIdAndDelete(id).lean().exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return { id };
  }

  async getUserFavoriteMeals(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const favoriteMealsIds = Array.isArray((user as any).favoriteMeals)
      ? (user as any).favoriteMeals
      : Object.values((user as any).favoriteMeals || {});

    logger.info("Original favorite meal IDs:", favoriteMealsIds);

    const validIds = favoriteMealsIds
      .filter((id: any) => id)
      .map((id: any) => {
        try {
          return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
        } catch (e) {
          logger.error("Invalid meal ID:", id);
          return null;
        }
      })
      .filter((id: any) => id !== null);

    logger.info("Converted valid ObjectIds:", validIds);

    const favoriteMeals = await this.mealModel
      .find({
        _id: { $in: validIds },
      })
      .lean()
      .exec();

    logger.info("Found favorite meals:", favoriteMeals.length);
    return {
      success: true,
      data: favoriteMeals,
    };
  }

  async updateUserFavoriteMeals(
    userId: string,
    isFavorite: boolean,
    mealId: string
  ) {
    logger.info("Updating favorite meals - Input mealId:", mealId);

    const mealIdStr =
      typeof mealId === "object" ? JSON.stringify(mealId) : mealId;

    const meal = await this.mealModel.findById(mealIdStr);
    if (!meal) {
      logger.error(`Meal not found with ID: ${mealId}`);
      throw new NotFoundException("Meal not found");
    }
    logger.info("Found meal:", meal._id.toString(), meal.name);

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    let favoriteMeals = Array.isArray((user as any).favoriteMeals)
      ? (user as any).favoriteMeals
      : [];
    logger.info("Current favorite meals:", favoriteMeals);

    if (isFavorite && !favoriteMeals.includes(mealIdStr)) {
      favoriteMeals.push(mealIdStr);
      logger.info("Added to favorite meals:", mealIdStr);
    } else if (!isFavorite) {
      favoriteMeals = favoriteMeals.filter((id: string) => id !== mealIdStr);
      logger.info("Removed from favorite meals:", mealIdStr);
    }

    (user as any).favoriteMeals = favoriteMeals;
    await user.save();
    return {
      success: true,
      data: user,
    };
  }
}

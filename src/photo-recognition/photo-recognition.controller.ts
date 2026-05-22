import { Controller, Post, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { SubscriptionGuard, RequiresFeature } from "../auth/guards/subscription.guard";
import { PhotoRecognitionService } from "./photo-recognition.service";
import {
  RecognizeMealDto,
  GetNutritionDto,
  RecognizedMealResponse,
  NutritionResponse,
} from "./dto/recognize-meal.dto";
import logger from "../utils/logger";

@ApiTags("Photo Recognition")
@Controller("photo")
@UseGuards(AuthGuard, SubscriptionGuard)
@ApiBearerAuth("JWT-auth")
export class PhotoRecognitionController {
  constructor(private readonly photoRecognitionService: PhotoRecognitionService) {}

  @Post("recognize")
  @RequiresFeature("photoRecognition")
  @ApiOperation({
    summary: "Recognize meal from photo",
    description: "Uses AI vision to identify a meal from a base64 encoded photo",
  })
  @ApiResponse({
    status: 200,
    description: "Meal recognized successfully",
    schema: {
      properties: {
        success: { type: "boolean" },
        data: {
          properties: {
            mealName: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
            description: { type: "string" },
            aiEstimates: {
              properties: {
                calories: { type: "number" },
                macros: {
                  properties: {
                    protein: { type: "number" },
                    carbs: { type: "number" },
                    fat: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  async recognizeMeal(
    @Body() body: RecognizeMealDto
  ): Promise<{ success: boolean; data: RecognizedMealResponse }> {
    logger.info("[PhotoRecognition] Recognizing meal from photo");

    const result = await this.photoRecognitionService.recognizeMealFromPhoto(
      body.imageBase64
    );

    logger.info(
      `[PhotoRecognition] Recognition result: ${result.mealName} (${result.confidence})`
    );

    return {
      success: true,
      data: result,
    };
  }

  @Post("nutrition")
  @ApiOperation({
    summary: "Get nutrition data from USDA",
    description: "Fetches nutrition information for a meal from USDA FoodData Central API",
  })
  @ApiResponse({
    status: 200,
    description: "Nutrition data retrieved successfully",
    schema: {
      properties: {
        success: { type: "boolean" },
        data: {
          properties: {
            calories: { type: "number" },
            macros: {
              properties: {
                protein: { type: "number" },
                carbs: { type: "number" },
                fat: { type: "number" },
              },
            },
            servingSize: { type: "string" },
            source: { type: "string" },
            fdcId: { type: "string" },
          },
        },
      },
    },
  })
  async getNutrition(
    @Body() body: GetNutritionDto
  ): Promise<{ success: boolean; data: NutritionResponse | null; message?: string }> {
    logger.info(`[PhotoRecognition] Getting nutrition for: ${body.mealName}`);

    const nutrition = await this.photoRecognitionService.getNutritionFromUSDA(
      body.mealName
    );

    if (!nutrition) {
      logger.info(`[PhotoRecognition] No USDA data for "${body.mealName}", trying AI fallback`);
      const aiNutrition = await this.photoRecognitionService.getNutritionFromAI(body.mealName);
      if (aiNutrition) {
        logger.info(`[PhotoRecognition] AI estimate: ${aiNutrition.calories} cal`);
        return { success: true, data: aiNutrition };
      }
      return {
        success: false,
        data: null,
        message: `No nutrition data found for "${body.mealName}". Please enter manually.`,
      };
    }

    logger.info(
      `[PhotoRecognition] USDA nutrition: ${nutrition.calories} cal, ${nutrition.macros.protein}g protein`
    );

    return {
      success: true,
      data: nutrition,
    };
  }
}

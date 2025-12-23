import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Body,
  Param,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
  ApiParam,
} from "@nestjs/swagger";
import { ShoppingService } from "./shopping.service";
import { AuthGuard } from "../auth/auth.guard";
import {
  UpdateShoppingItemDto,
  AddProductsDto,
  AddMealToShoppingListDto,
} from "./dto";

@ApiTags("shopping")
@Controller("shopping")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT-auth")
export class ShoppingController {
  constructor(private readonly shoppingService: ShoppingService) {}

  @Get("list")
  @ApiOperation({
    summary: "Get shopping list for a plan (returns cached if exists)",
  })
  @ApiQuery({ name: "planId", required: true, description: "ID of the plan" })
  @ApiResponse({
    status: 200,
    description: "Shopping list retrieved successfully",
  })
  async getShoppingList(@Query("planId") planId: string) {
    return this.shoppingService.generateShoppingList(planId);
  }

  @Post("list/regenerate")
  @ApiOperation({
    summary: "Force regenerate shopping list (ignores cached version)",
  })
  @ApiQuery({ name: "planId", required: true, description: "ID of the plan" })
  @ApiResponse({
    status: 200,
    description: "Shopping list regenerated successfully",
  })
  async regenerateShoppingList(@Query("planId") planId: string) {
    return this.shoppingService.regenerateShoppingList(planId);
  }

  @Post(":planId/items")
  @ApiOperation({
    summary:
      "Add products to shopping list. If product exists (not done), adds to amount. If done or not exists, adds new.",
  })
  @ApiParam({ name: "planId", description: "Plan ID" })
  @ApiBody({ type: AddProductsDto })
  @ApiResponse({
    status: 200,
    description: "Products added to shopping list successfully",
  })
  @ApiResponse({ status: 404, description: "Plan not found" })
  async addProductsToShoppingList(
    @Param("planId") planId: string,
    @Body() body: AddProductsDto
  ) {
    return this.shoppingService.addProductsToShoppingList(planId, body.items);
  }

  @Post("list/add-meal")
  @ApiOperation({
    summary: "Add all ingredients from a meal to shopping list",
  })
  @ApiBody({ type: AddMealToShoppingListDto })
  @ApiResponse({
    status: 200,
    description: "Meal ingredients added to shopping list successfully",
  })
  @ApiResponse({ status: 404, description: "Plan or meal not found" })
  async addMealToShoppingList(
    @Body() body: AddMealToShoppingListDto,
    @Request() req
  ) {
    return this.shoppingService.addMealToShoppingList(body.planId, body.mealId);
  }

  @Delete(":planId/items/:productName")
  @ApiOperation({
    summary: "Delete a product from the shopping list",
  })
  @ApiParam({ name: "planId", description: "Plan ID" })
  @ApiParam({
    name: "productName",
    description: "Name of the product to delete",
  })
  @ApiResponse({ status: 200, description: "Product deleted successfully" })
  @ApiResponse({ status: 404, description: "Product not found" })
  async deleteProductFromShoppingList(
    @Param("planId") planId: string,
    @Param("productName") productName: string
  ) {
    return this.shoppingService.deleteProductFromShoppingList(
      planId,
      productName
    );
  }

  @Put(":planId/items")
  @ApiOperation({
    summary:
      "Update multiple products in the shopping list (mark as done/undone)",
  })
  @ApiParam({ name: "planId", description: "Plan ID" })
  @ApiResponse({ status: 200, description: "Products updated successfully" })
  @ApiResponse({ status: 404, description: "Shopping list not found" })
  async updateShoppingItems(
    @Param("planId") planId: string,
    @Body() body: UpdateShoppingItemDto
  ) {
    return this.shoppingService.updateShoppingItems(
      planId,
      body.item.name,
      body.item.done
    );
  }
}

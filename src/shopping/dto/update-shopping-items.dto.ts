import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

// Reusable product DTO for shopping list operations
export class ProductDto {
  @ApiProperty({
    example: "chicken_breast",
    description: "Name of the product",
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: "500 g",
    description: "Amount with unit",
    required: false,
  })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiProperty({
    example: "Proteins",
    description: "Product category",
    required: false,
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    example: false,
    description: "Whether the product has been purchased",
  })
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

// DTO for adding products to shopping list
export class AddProductsDto {
  @ApiProperty({
    type: [ProductDto],
    description: "Products to add",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDto)
  items: ProductDto[];
}

// DTO for adding meal ingredients to shopping list
export class AddMealToShoppingListDto {
  @ApiProperty({
    example: "507f1f77bcf86cd799439011",
    description: "Plan ID",
  })
  @IsNotEmpty()
  @IsString()
  planId: string;

  @ApiProperty({
    example: "507f1f77bcf86cd799439011",
    description: "Meal ID",
  })
  @IsNotEmpty()
  @IsString()
  mealId: string;
}

// DTO for updating shopping item status
export class ShoppingItemUpdateDto {
  @ApiProperty({
    example: "chicken_breast",
    description: "Name of the product",
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: true,
    description: "Whether the product has been purchased",
  })
  @IsNotEmpty()
  @IsBoolean()
  done: boolean;
}

export class UpdateShoppingItemDto {
  @ApiProperty({
    type: ShoppingItemUpdateDto,
    description: "Item to update",
    example: { name: "chicken_breast", done: true },
  })
  @IsObject()
  @ValidateNested()
  @Type(() => ShoppingItemUpdateDto)
  item: ShoppingItemUpdateDto;
}

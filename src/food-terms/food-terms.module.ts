import { Module } from "@nestjs/common";
import { FoodTermsController } from "./food-terms.controller";
import { FoodTermsService } from "./food-terms.service";

@Module({
  controllers: [FoodTermsController],
  providers: [FoodTermsService],
  exports: [FoodTermsService],
})
export class FoodTermsModule {}

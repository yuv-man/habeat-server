import axios from "axios";
import { PhotoRecognitionService } from "../../../src/photo-recognition/photo-recognition.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const searchResult = (food: any) => ({ data: { foods: [food] } });

// A quesadilla-like food: ~280 kcal per 100g.
const per100g = [
  { nutrientName: "Energy", nutrientNumber: "1008", value: 280 },
  { nutrientName: "Protein", nutrientNumber: "1003", value: 14 },
  { nutrientName: "Carbohydrate, by difference", nutrientNumber: "1005", value: 30 },
  { nutrientName: "Total lipid (fat)", nutrientNumber: "1004", value: 12 },
];

describe("getNutritionFromUSDA — per-100g must be scaled to a serving", () => {
  let service: PhotoRecognitionService;
  const OLD = process.env.USDA_API_KEY;

  beforeAll(() => {
    process.env.USDA_API_KEY = "test-key";
    service = new PhotoRecognitionService();
  });
  afterAll(() => {
    process.env.USDA_API_KEY = OLD;
  });
  beforeEach(() => jest.clearAllMocks());

  it("scales by servingSize in grams (280/100g × 200g = 560, not 280)", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      searchResult({
        description: "Quesadilla, beef",
        fdcId: 1,
        servingSize: 200,
        servingSizeUnit: "g",
        foodNutrients: per100g,
      })
    );
    const r = await service.getNutritionFromUSDA("Honey Glazed Beef Quesadilla");
    expect(r).not.toBeNull();
    expect(r!.calories).toBe(560); // was 280 (per-100g) before the fix
    expect(r!.macros.protein).toBe(28);
    expect(r!.servingSize).toBe("200 g");
  });

  it("scales by the largest food portion gramWeight when no servingSize", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      searchResult({
        description: "Quesadilla, beef",
        fdcId: 2,
        foodPortions: [{ gramWeight: 85 }, { gramWeight: 250 }],
        foodNutrients: per100g,
      })
    );
    const r = await service.getNutritionFromUSDA("Beef Quesadilla");
    expect(r!.calories).toBe(700); // 280 × 2.5
    expect(r!.servingSize).toBe("250 g");
  });

  it("defers to AI (returns null) when there is no reliable serving weight", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      searchResult({
        description: "Quesadilla, beef",
        fdcId: 3,
        foodNutrients: per100g, // per-100g only, no serving info
      })
    );
    // Search retry (simplified query) also returns the same shape; only one
    // call happens because foods.length > 0 on the first try.
    const r = await service.getNutritionFromUSDA("Honey Glazed Beef Quesadilla");
    expect(r).toBeNull();
  });

  it("ignores a serving unit that isn't a weight (e.g. 'cup')", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      searchResult({
        description: "Soup",
        fdcId: 4,
        servingSize: 1,
        servingSizeUnit: "cup",
        foodNutrients: per100g,
      })
    );
    const r = await service.getNutritionFromUSDA("Some Soup");
    expect(r).toBeNull(); // can't convert "1 cup" to grams safely → defer to AI
  });

  it("defers to AI when the match has zero energy", async () => {
    mockedAxios.get.mockResolvedValueOnce(
      searchResult({
        description: "Water",
        fdcId: 5,
        servingSize: 240,
        servingSizeUnit: "g",
        foodNutrients: [{ nutrientName: "Energy", nutrientNumber: "1008", value: 0 }],
      })
    );
    const r = await service.getNutritionFromUSDA("Water");
    expect(r).toBeNull();
  });
});

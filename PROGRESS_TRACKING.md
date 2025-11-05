# Daily Progress Tracking System

This document describes the comprehensive daily progress tracking system implemented for the Habeat meal planning application.

## Overview

The daily progress tracking system allows users to monitor their daily nutrition, hydration, exercise, and meal completion progress. It automatically syncs with the user's meal plan to provide accurate calorie goals and tracking.

## Daily Progress Flow

### 🎯 **Start of Day (0 Calories)**
- Each day starts with **0 calories consumed**
- Progress is automatically initialized when user first accesses the system
- Goals are synced from the user's meal plan for that specific day

### 📈 **Throughout the Day (Building Calories)**
- As user completes meals from their plan, calories are automatically added
- Progress builds up throughout the day: 0 → 350 (breakfast) → 800 (lunch) → 1350 (dinner)
- Real-time progress tracking with percentages and remaining calories

### 🔄 **Meal Completion Process**
1. User marks a meal as completed from their plan
2. System automatically adds the meal's calories to daily total
3. Progress percentage and remaining calories are updated
4. User can see immediate feedback on their progress

## Features

### 1. Daily Progress Tracking
- **Calories**: Track consumed vs. goal calories (starts at 0, builds throughout day)
- **Water**: Monitor water intake (glasses) - synced with plan goals
- **Workouts**: Track completed workouts and exercise minutes
- **Meals**: Mark meals as completed (breakfast, lunch, dinner, snacks) - automatically adds calories from plan
- **Weight**: Optional daily weight tracking
- **Notes**: Add personal notes for each day

### 2. Automatic Goal Calculation & Synchronization
- Calorie goals are automatically set from the user's TDEE (Total Daily Energy Expenditure)
- Water goals are synced from the user's meal plan dietary restrictions for each day
- Workout goals default to 1 per day
- **NEW**: When meals are marked as completed, calories are automatically added from the meal plan
- **NEW**: Custom calories can be added for meals not in the plan
- **NEW**: Each day starts fresh with 0 calories

### 3. Progress Analytics
- Real-time progress percentages
- Status indicators (excellent, good, fair, needs_improvement)
- Weekly summaries and trends
- Meal completion rates

## API Endpoints

### Progress Management

#### Get Today's Progress (Starts at 0)
```http
GET /api/progress/today
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "progress": {
      "userId": "...",
      "date": "2024-01-15T00:00:00.000Z",
      "caloriesConsumed": 0,
      "caloriesGoal": 2000,
      "waterGlasses": 0,
      "waterGoal": 8,
      "workoutsCompleted": 0,
      "workoutsGoal": 1,
      "mealsCompleted": {
        "breakfast": false,
        "lunch": false,
        "dinner": false,
        "snacks": 0
      },
      "exerciseMinutes": 0
    },
    "stats": {
      "calories": {
        "consumed": 0,
        "goal": 2000,
        "percentage": 0,
        "deficit": 2000,
        "status": "needs_improvement"
      }
    },
    "message": "Day started! Complete meals from your plan to track calories."
  }
}
```

#### Reset Today's Progress to 0
```http
DELETE /api/progress/today
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "progress": { /* reset progress data */ },
    "stats": { /* reset stats */ },
    "message": "Day reset! Start fresh by completing meals from your plan."
  }
}
```

#### Update Today's Progress
```http
PUT /api/progress/today
Authorization: Bearer <token>
Content-Type: application/json

{
  "caloriesConsumed": 1600,
  "waterGlasses": 7,
  "workoutsCompleted": 1,
  "exerciseMinutes": 60,
  "weight": 70.2,
  "notes": "Great workout session!"
}
```

#### Get Progress by Date
```http
GET /api/progress/date/2024-01-15
Authorization: Bearer <token>
```

#### Get Progress by Date Range
```http
GET /api/progress/range?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <token>
```

### Meal Plan Synchronized Tracking

#### Mark Meal as Completed (Auto-adds calories from plan)
```http
POST /api/progress/meal/breakfast
Authorization: Bearer <token>
Content-Type: application/json

{
  "completed": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "progress": { /* updated progress */ },
    "stats": { /* updated stats */ },
    "caloriesAdded": 350,
    "previousCalories": 0,
    "currentCalories": 350,
    "progressPercentage": 18,
    "remainingCalories": 1650,
    "mealInfo": {
      "name": "Oatmeal with berries",
      "calories": 350,
      "protein": 12,
      "carbs": 45,
      "fat": 8
    },
    "message": "Added 350 calories! Progress: 350/2000 (18%)"
  }
}
```

For snacks with specific index:
```json
{
  "completed": true,
  "snackIndex": 0
}
```

For custom calories (when not following plan):
```json
{
  "completed": true,
  "customCalories": 400
}
```

#### Add Custom Calories (for meals not in plan)
```http
POST /api/progress/custom-calories
Authorization: Bearer <token>
Content-Type: application/json

{
  "calories": 500,
  "mealName": "Pizza slice",
  "mealType": "lunch"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "progress": { /* updated progress */ },
    "stats": { /* updated stats */ },
    "caloriesAdded": 500,
    "previousCalories": 350,
    "currentCalories": 850,
    "progressPercentage": 43,
    "remainingCalories": 1150,
    "message": "Added 500 calories for Pizza slice! Progress: 850/2000 (43%)"
  }
}
```

### Water Tracking

#### Add Water Glass (simple increment)
```http
POST /api/progress/water
Authorization: Bearer <token>
```

#### Update Water Intake (set specific amount, syncs with plan)
```http
PUT /api/progress/water
Authorization: Bearer <token>
Content-Type: application/json

{
  "glasses": 8
}
```

### Exercise Tracking

#### Add Workout (simple increment)
```http
POST /api/progress/workout
Authorization: Bearer <token>
```

#### Update Exercise (with minutes and calories burned, syncs with plan)
```http
PUT /api/progress/exercise
Authorization: Bearer <token>
Content-Type: application/json

{
  "exerciseMinutes": 45,
  "caloriesBurned": 300
}
```

#### Get Weekly Summary
```http
GET /api/progress/weekly?weekStart=2024-01-15
Authorization: Bearer <token>
```

### Meal Plan Integration

#### Track Meal Consumption (from plan)
```http
POST /api/plan/track-meal
Authorization: Bearer <token>
Content-Type: application/json

{
  "day": "monday",
  "mealType": "breakfast",
  "consumed": true
}
```

For snacks:
```json
{
  "day": "monday",
  "mealType": "snacks",
  "consumed": true,
  "snackIndex": 0
}
```

For custom calories:
```json
{
  "day": "monday",
  "mealType": "lunch",
  "consumed": true,
  "customCalories": 600
}
```

## Synchronization Features

### 1. Daily Progress Flow
- **Morning**: Start with 0 calories, 0 water glasses, 0 workouts
- **Throughout Day**: Build calories by completing meals from plan
- **Real-time Updates**: See progress percentage and remaining calories
- **End of Day**: Complete picture of daily nutrition and activity

### 2. Automatic Calorie Tracking
- When a meal from the plan is marked as completed, its calories are automatically added to daily progress
- Goals are synced from the user's TDEE calculation
- Custom calories can be added for meals not in the plan
- Progress builds incrementally: 0 → 350 → 800 → 1350 calories

### 3. Water Goal Synchronization
- Water goals are pulled from the meal plan for each specific day
- Users can track actual vs. planned water intake
- Starts at 0 glasses each day

### 4. Exercise Integration
- Exercise calories burned are subtracted from consumed calories for net calorie calculation
- Workout tracking is integrated with the progress system
- Starts at 0 workouts each day

### 5. Meal Plan Integration
- Progress automatically syncs with the user's weekly meal plan
- Each day's goals are based on that specific day's plan
- Meal completion status is tracked per meal type
- Fresh start each day with 0 calories

## Usage Examples

### Frontend Integration

```javascript
// Get today's progress (starts at 0)
const getTodayProgress = async () => {
  const response = await fetch('/api/progress/today', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return data.data;
};

// Mark breakfast as completed (auto-adds calories from plan)
const markBreakfastCompleted = async () => {
  const response = await fetch('/api/progress/meal/breakfast', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ completed: true })
  });
  const data = await response.json();
  console.log(`Added ${data.data.caloriesAdded} calories from breakfast`);
  console.log(`Progress: ${data.data.currentCalories}/${data.data.progress.caloriesGoal} (${data.data.progressPercentage}%)`);
  return data;
};

// Add custom calories for a meal not in plan
const addCustomMeal = async () => {
  const response = await fetch('/api/progress/custom-calories', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      calories: 450,
      mealName: "Restaurant lunch",
      mealType: "lunch"
    })
  });
  return response.json();
};

// Reset day to start fresh
const resetDay = async () => {
  const response = await fetch('/api/progress/today', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
```

### Progress Dashboard Data

The system provides comprehensive data for building progress dashboards:

```javascript
const progressData = {
  today: {
    calories: { consumed: 1450, goal: 2000, percentage: 73, status: 'good' },
    water: { consumed: 6, goal: 8, percentage: 75, status: 'good' },
    workouts: { completed: 1, goal: 1, percentage: 100, status: 'excellent' },
    meals: { completionRate: 67, status: 'fair' }
  },
  weekly: {
    totalCaloriesConsumed: 12500,
    averageCaloriesPerDay: 1786,
    totalWorkouts: 5,
    averageWaterPerDay: 7.2
  },
  mealPlan: {
    todayMeals: [
      { type: 'breakfast', name: 'Oatmeal with berries', calories: 350, completed: true },
      { type: 'lunch', name: 'Grilled chicken salad', calories: 450, completed: false },
      { type: 'dinner', name: 'Salmon with vegetables', calories: 550, completed: false }
    ]
  }
};
```

### Daily Progress Flow Example

```javascript
// Morning - Start fresh
const morningProgress = {
  caloriesConsumed: 0,
  caloriesGoal: 2000,
  progressPercentage: 0,
  message: "Day started! Complete meals from your plan to track calories."
};

// After breakfast
const afterBreakfast = {
  caloriesConsumed: 350,
  caloriesGoal: 2000,
  progressPercentage: 18,
  message: "Added 350 calories! Progress: 350/2000 (18%)"
};

// After lunch
const afterLunch = {
  caloriesConsumed: 800,
  caloriesGoal: 2000,
  progressPercentage: 40,
  message: "Added 450 calories! Progress: 800/2000 (40%)"
};

// After dinner
const afterDinner = {
  caloriesConsumed: 1350,
  caloriesGoal: 2000,
  progressPercentage: 68,
  message: "Added 550 calories! Progress: 1350/2000 (68%)"
};
```

## Data Models

### DailyProgress Schema
```typescript
interface IDailyProgress {
  userId: mongoose.Types.ObjectId;
  date: Date;
  caloriesConsumed: number; // Starts at 0 each day
  caloriesGoal: number;
  waterGlasses: number; // Starts at 0 each day
  waterGoal: number;
  workoutsCompleted: number; // Starts at 0 each day
  workoutsGoal: number;
  mealsCompleted: {
    breakfast: boolean; // Starts as false
    lunch: boolean; // Starts as false
    dinner: boolean; // Starts as false
    snacks: number; // Starts at 0
  };
  exerciseMinutes: number; // Starts at 0
  weight?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## Progress Status Levels

- **Excellent**: 90-100%
- **Good**: 75-89%
- **Fair**: 50-74%
- **Needs Improvement**: 0-49%

## Database Indexes

The system includes optimized database indexes for efficient queries:

- Compound index on `userId` and `date` for daily progress lookups
- Index on `date` for date range queries
- Unique constraint on `userId` + `date` to prevent duplicate entries

## Error Handling

All endpoints include comprehensive error handling:

- 404: Progress not found for specified date
- 400: Invalid request parameters
- 401: Unauthorized (missing or invalid token)
- 500: Server error

## Future Enhancements

1. **Progress Streaks**: Track consecutive days of goal achievement
2. **Progress Photos**: Allow users to upload progress photos
3. **Social Features**: Share progress with friends or community
4. **Advanced Analytics**: Trend analysis and predictions
5. **Goal Adjustments**: Allow users to modify daily goals
6. **Progress Reminders**: Push notifications for tracking
7. **Export Data**: Allow users to export their progress data
8. **Meal Photos**: Allow users to upload photos of completed meals
9. **Nutrition Tracking**: Track macros (protein, carbs, fat) from meals
10. **Recipe Integration**: Link completed meals to recipe details

## Implementation Notes

- Progress entries are automatically created for new days with 0 calories
- Goals are automatically synced from the user's meal plan
- All progress data is user-specific and private
- The system supports multiple time zones
- Progress data is retained indefinitely for historical analysis
- Meal plan synchronization ensures accurate calorie tracking
- Custom calories can be added for flexibility when not following the plan
- **Each day starts fresh with 0 calories and builds throughout the day** 
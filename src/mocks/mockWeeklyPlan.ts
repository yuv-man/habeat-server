import mockWeekPlan from './mockWeekPlan.json';
import { IDailyPlan } from '../types/interfaces';

const generateFullWeek = () => {
  return {
    weeklyPlan: mockWeekPlan.data.plan.weeklyPlan.map(day => ({
      ...day,
      day: day.day.toLowerCase() as 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
      date: new Date(day.date)
    })) as IDailyPlan[]
  };
};

export { generateFullWeek };
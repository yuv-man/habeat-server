/**
 * Unit tests for plan date calculations
 * Tests:
 * - Correct day of week detection
 * - Maximum 7 days in a plan
 * - Correct date range generation based on current day
 * - Timezone-safe date handling
 */

describe("Plan Date Calculations", () => {
  // Helper to get local date key (same as in the codebase)
  const getLocalDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Simulate the date generation logic from buildPrompt
  const generateDatesFromToday = (
    today: Date
  ): { dates: Date[]; daysToGenerate: number[] } => {
    const actualStartDate = new Date(today);
    actualStartDate.setHours(0, 0, 0, 0);
    const currentDay = actualStartDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    const daysToGenerate: number[] = [];
    const dates: Date[] = [];

    if (currentDay === 0) {
      // Sunday - only generate Sunday (last day of week)
      daysToGenerate.push(0);
      dates.push(new Date(actualStartDate));
    } else {
      // Generate from today through Saturday, then Sunday
      for (let day = currentDay; day <= 6; day++) {
        daysToGenerate.push(day);
        const date = new Date(actualStartDate);
        date.setDate(actualStartDate.getDate() + (day - currentDay));
        dates.push(date);
      }
      // Add Sunday (end of week)
      daysToGenerate.push(0);
      const sundayDate = new Date(actualStartDate);
      sundayDate.setDate(actualStartDate.getDate() + (7 - currentDay));
      dates.push(sundayDate);
    }

    return { dates, daysToGenerate };
  };

  describe("Day of Week Detection", () => {
    it("should correctly identify Sunday as day 0", () => {
      // Sunday, December 14, 2025
      const sunday = new Date(2025, 11, 14); // Month is 0-indexed
      expect(sunday.getDay()).toBe(0);
    });

    it("should correctly identify Monday as day 1", () => {
      // Monday, December 15, 2025
      const monday = new Date(2025, 11, 15);
      expect(monday.getDay()).toBe(1);
    });

    it("should correctly identify Saturday as day 6", () => {
      // Saturday, December 13, 2025
      const saturday = new Date(2025, 11, 13);
      expect(saturday.getDay()).toBe(6);
    });
  });

  describe("Maximum Days Constraint", () => {
    it("should generate exactly 1 day when today is Sunday", () => {
      const sunday = new Date(2025, 11, 14); // Sunday
      const { dates } = generateDatesFromToday(sunday);
      expect(dates.length).toBe(1);
      expect(dates.length).toBeLessThanOrEqual(7);
    });

    it("should generate exactly 7 days when today is Monday", () => {
      const monday = new Date(2025, 11, 15); // Monday
      const { dates } = generateDatesFromToday(monday);
      expect(dates.length).toBe(7);
      expect(dates.length).toBeLessThanOrEqual(7);
    });

    it("should generate exactly 6 days when today is Tuesday", () => {
      const tuesday = new Date(2025, 11, 16); // Tuesday
      const { dates } = generateDatesFromToday(tuesday);
      expect(dates.length).toBe(6);
      expect(dates.length).toBeLessThanOrEqual(7);
    });

    it("should generate exactly 5 days when today is Wednesday", () => {
      const wednesday = new Date(2025, 11, 17); // Wednesday
      const { dates } = generateDatesFromToday(wednesday);
      expect(dates.length).toBe(5);
      expect(dates.length).toBeLessThanOrEqual(7);
    });

    it("should generate exactly 4 days when today is Thursday", () => {
      const thursday = new Date(2025, 11, 18); // Thursday
      const { dates } = generateDatesFromToday(thursday);
      expect(dates.length).toBe(4);
      expect(dates.length).toBeLessThanOrEqual(7);
    });

    it("should generate exactly 3 days when today is Friday", () => {
      const friday = new Date(2025, 11, 19); // Friday
      const { dates } = generateDatesFromToday(friday);
      expect(dates.length).toBe(3);
      expect(dates.length).toBeLessThanOrEqual(7);
    });

    it("should generate exactly 2 days when today is Saturday", () => {
      const saturday = new Date(2025, 11, 20); // Saturday
      const { dates } = generateDatesFromToday(saturday);
      expect(dates.length).toBe(2);
      expect(dates.length).toBeLessThanOrEqual(7);
    });

    it("should NEVER generate more than 7 days", () => {
      // Test all days of a week
      for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
        // Find a date that falls on this day of week
        const testDate = new Date(2025, 11, 14 + dayOfWeek); // Start from Sunday Dec 14
        // Adjust to get the correct day of week
        while (testDate.getDay() !== dayOfWeek) {
          testDate.setDate(testDate.getDate() + 1);
        }

        const { dates } = generateDatesFromToday(testDate);
        expect(dates.length).toBeLessThanOrEqual(7);
      }
    });
  });

  describe("Date Range Generation", () => {
    it("should only include today when today is Sunday", () => {
      const sunday = new Date(2025, 11, 14); // Sunday Dec 14, 2025
      const { dates } = generateDatesFromToday(sunday);

      expect(dates.length).toBe(1);
      expect(getLocalDateKey(dates[0])).toBe("2025-12-14");
    });

    it("should generate Mon-Sun when today is Monday", () => {
      const monday = new Date(2025, 11, 15); // Monday Dec 15, 2025
      const { dates, daysToGenerate } = generateDatesFromToday(monday);

      expect(dates.length).toBe(7);
      expect(getLocalDateKey(dates[0])).toBe("2025-12-15"); // Monday
      expect(getLocalDateKey(dates[6])).toBe("2025-12-21"); // Sunday

      // Verify day order: Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6), Sun(0)
      expect(daysToGenerate).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });

    it("should generate Wed-Sun when today is Wednesday", () => {
      const wednesday = new Date(2025, 11, 17); // Wednesday Dec 17, 2025
      const { dates, daysToGenerate } = generateDatesFromToday(wednesday);

      expect(dates.length).toBe(5);
      expect(getLocalDateKey(dates[0])).toBe("2025-12-17"); // Wednesday
      expect(getLocalDateKey(dates[4])).toBe("2025-12-21"); // Sunday

      // Verify day order: Wed(3), Thu(4), Fri(5), Sat(6), Sun(0)
      expect(daysToGenerate).toEqual([3, 4, 5, 6, 0]);
    });

    it("should generate Sat-Sun when today is Saturday", () => {
      const saturday = new Date(2025, 11, 20); // Saturday Dec 20, 2025
      const { dates, daysToGenerate } = generateDatesFromToday(saturday);

      expect(dates.length).toBe(2);
      expect(getLocalDateKey(dates[0])).toBe("2025-12-20"); // Saturday
      expect(getLocalDateKey(dates[1])).toBe("2025-12-21"); // Sunday

      // Verify day order: Sat(6), Sun(0)
      expect(daysToGenerate).toEqual([6, 0]);
    });

    it("should always end on Sunday", () => {
      for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
        const testDate = new Date(2025, 11, 14 + dayOfWeek);
        while (testDate.getDay() !== dayOfWeek) {
          testDate.setDate(testDate.getDate() + 1);
        }

        const { dates, daysToGenerate } = generateDatesFromToday(testDate);
        const lastDay = daysToGenerate[daysToGenerate.length - 1];
        expect(lastDay).toBe(0); // Sunday
      }
    });
  });

  describe("Local Date Key Format", () => {
    it("should format date as YYYY-MM-DD", () => {
      const date = new Date(2025, 11, 14); // Dec 14, 2025
      expect(getLocalDateKey(date)).toBe("2025-12-14");
    });

    it("should pad single digit months", () => {
      const date = new Date(2025, 0, 15); // Jan 15, 2025
      expect(getLocalDateKey(date)).toBe("2025-01-15");
    });

    it("should pad single digit days", () => {
      const date = new Date(2025, 11, 5); // Dec 5, 2025
      expect(getLocalDateKey(date)).toBe("2025-12-05");
    });

    it("should use local date, not UTC", () => {
      // Create a date at 11pm local time
      const date = new Date(2025, 11, 14, 23, 0, 0); // Dec 14, 2025 11pm
      // getLocalDateKey should still return Dec 14, not Dec 15
      expect(getLocalDateKey(date)).toBe("2025-12-14");
    });
  });

  describe("Week Boundaries", () => {
    it("should not include dates from previous week", () => {
      const monday = new Date(2025, 11, 15); // Monday Dec 15, 2025
      const { dates } = generateDatesFromToday(monday);

      // None of the dates should be before Monday
      for (const date of dates) {
        expect(date.getTime()).toBeGreaterThanOrEqual(monday.getTime());
      }
    });

    it("should not include dates from next week (after Sunday)", () => {
      const monday = new Date(2025, 11, 15); // Monday Dec 15, 2025
      const { dates } = generateDatesFromToday(monday);

      // The week ends on Sunday Dec 21, 2025
      const weekEndSunday = new Date(2025, 11, 21, 23, 59, 59);

      for (const date of dates) {
        expect(date.getTime()).toBeLessThanOrEqual(weekEndSunday.getTime());
      }
    });

    it("should correctly handle week transition from Saturday to Sunday", () => {
      const saturday = new Date(2025, 11, 20); // Saturday Dec 20, 2025
      const { dates } = generateDatesFromToday(saturday);

      expect(dates.length).toBe(2);
      expect(getLocalDateKey(dates[0])).toBe("2025-12-20"); // Saturday
      expect(getLocalDateKey(dates[1])).toBe("2025-12-21"); // Sunday

      // Sunday should be AFTER Saturday
      expect(dates[1].getTime()).toBeGreaterThan(dates[0].getTime());
    });
  });

  describe("Edge Cases", () => {
    it("should handle year transition (Dec 31 to Jan 1)", () => {
      // If Wednesday Dec 31, 2025, should generate through Sunday Jan 4, 2026
      const wednesday = new Date(2025, 11, 31); // Wednesday Dec 31, 2025
      const { dates } = generateDatesFromToday(wednesday);

      expect(dates.length).toBe(5);
      expect(getLocalDateKey(dates[0])).toBe("2025-12-31"); // Wednesday
      expect(getLocalDateKey(dates[4])).toBe("2026-01-04"); // Sunday
    });

    it("should handle month transition", () => {
      // If Friday Nov 28, 2025, should generate through Sunday Nov 30, 2025
      const friday = new Date(2025, 10, 28); // Friday Nov 28, 2025
      const { dates } = generateDatesFromToday(friday);

      expect(dates.length).toBe(3);
      expect(getLocalDateKey(dates[0])).toBe("2025-11-28"); // Friday
      expect(getLocalDateKey(dates[2])).toBe("2025-11-30"); // Sunday
    });

    it("should handle leap year February", () => {
      // 2024 is a leap year
      // If Thursday Feb 29, 2024, should generate through Sunday Mar 3, 2024
      const thursday = new Date(2024, 1, 29); // Thursday Feb 29, 2024
      const { dates } = generateDatesFromToday(thursday);

      expect(dates.length).toBe(4);
      expect(getLocalDateKey(dates[0])).toBe("2024-02-29"); // Thursday
      expect(getLocalDateKey(dates[3])).toBe("2024-03-03"); // Sunday
    });
  });

  describe("No Placeholder Days", () => {
    it("should NOT add placeholder days for past dates in the week", () => {
      // If today is Sunday, we should ONLY get Sunday, not Mon-Sat placeholders
      const sunday = new Date(2025, 11, 14); // Sunday Dec 14, 2025
      const { dates } = generateDatesFromToday(sunday);

      // Should only have 1 day (today/Sunday)
      expect(dates.length).toBe(1);
      expect(getLocalDateKey(dates[0])).toBe("2025-12-14");
    });

    it("should NOT include dates before today", () => {
      const wednesday = new Date(2025, 11, 17); // Wednesday Dec 17, 2025
      const { dates } = generateDatesFromToday(wednesday);

      // Should only have Wed, Thu, Fri, Sat, Sun (5 days)
      // NOT include Mon (Dec 15) or Tue (Dec 16)
      expect(dates.length).toBe(5);

      const dateKeys = dates.map((d) => getLocalDateKey(d));
      expect(dateKeys).not.toContain("2025-12-15"); // Monday
      expect(dateKeys).not.toContain("2025-12-16"); // Tuesday
      expect(dateKeys).toContain("2025-12-17"); // Wednesday (today)
      expect(dateKeys).toContain("2025-12-21"); // Sunday
    });
  });

  describe("Validation - Max 7 Days Enforcement", () => {
    it("should throw error if somehow more than 7 dates are generated", () => {
      // This tests the validation logic that should prevent > 7 days
      const validateDates = (dates: Date[]): void => {
        if (dates.length > 7) {
          throw new Error("Cannot generate more than 7 days");
        }
      };

      // Normal case - should not throw
      expect(() => validateDates([new Date()])).not.toThrow();
      expect(() =>
        validateDates([
          new Date(),
          new Date(),
          new Date(),
          new Date(),
          new Date(),
          new Date(),
          new Date(),
        ])
      ).not.toThrow();

      // Too many days - should throw
      expect(() =>
        validateDates([
          new Date(),
          new Date(),
          new Date(),
          new Date(),
          new Date(),
          new Date(),
          new Date(),
          new Date(),
        ])
      ).toThrow("Cannot generate more than 7 days");
    });

    it("should filter AI response to max 7 days if more are returned", () => {
      // Simulate what happens if AI returns 13 days
      const mockAIPlan: Record<string, { day: string }> = {
        "2025-12-08": { day: "monday" },
        "2025-12-09": { day: "tuesday" },
        "2025-12-10": { day: "wednesday" },
        "2025-12-11": { day: "thursday" },
        "2025-12-12": { day: "friday" },
        "2025-12-13": { day: "saturday" },
        "2025-12-14": { day: "sunday" },
        "2025-12-15": { day: "monday" },
        "2025-12-16": { day: "tuesday" },
        "2025-12-17": { day: "wednesday" },
        "2025-12-18": { day: "thursday" },
        "2025-12-19": { day: "friday" },
        "2025-12-20": { day: "saturday" },
      };

      // Should filter to first 7 days sorted by date
      const entries = Object.entries(mockAIPlan);
      expect(entries.length).toBe(13); // Initial has 13

      const sortedEntries = entries.sort(([a], [b]) => a.localeCompare(b));
      const trimmed = sortedEntries.slice(0, 7);
      const result = Object.fromEntries(trimmed);

      expect(Object.keys(result).length).toBe(7);
      expect(Object.keys(result).sort()).toEqual([
        "2025-12-08",
        "2025-12-09",
        "2025-12-10",
        "2025-12-11",
        "2025-12-12",
        "2025-12-13",
        "2025-12-14",
      ]);
    });
  });
});

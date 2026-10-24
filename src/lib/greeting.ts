/** i18n key of the time-of-day greeting shown as the headline of the new-task screens. */
export function greetingKeyFor(hour: number): string {
	if (hour >= 5 && hour < 12) return "hero.greetingMorning";
	if (hour >= 12 && hour < 18) return "hero.greetingAfternoon";
	if (hour >= 18 && hour < 23) return "hero.greetingEvening";
	return "hero.greetingNight";
}

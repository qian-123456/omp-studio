/** Time-of-day greeting shown as the headline of the new-task screens. */
export function greetingFor(hour: number): string {
	if (hour >= 5 && hour < 12) return "早上好，今天从哪里开始？";
	if (hour >= 12 && hour < 18) return "下午好，这一程想让我帮你做什么？";
	if (hour >= 18 && hour < 23) return "晚上好，夜色安静，正适合专心做点事。";
	return "还没睡？我陪你把它做完。";
}

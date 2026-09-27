const pad = (value: number) => String(value).padStart(2, "0");

export const reportNumberOf = (surveyId: string, startedAt: Date) => {
  const date = `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}`;
  const time = `${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}`;
  return `VIN-${surveyId.toUpperCase()}-${date}-${time}`;
};

const SQUARE_METRES_PER_HECTARE = 10_000;
const METRES_PER_KILOMETRE = 1_000;

const wholeNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatSquareMetres = (squareMetres: number) => `${wholeNumber.format(squareMetres)} m²`;

export const formatHectares = (squareMetres: number) =>
  `${twoDecimals.format(squareMetres / SQUARE_METRES_PER_HECTARE)} ha`;

export const formatMetres = (metres: number) => `${wholeNumber.format(metres)} m`;

export const formatWidth = (metres: number) => `${twoDecimals.format(metres)} m`;

export const formatKilometres = (metres: number) => `${twoDecimals.format(metres / METRES_PER_KILOMETRE)} km`;

export const formatDistance = (metres: number) =>
  metres < METRES_PER_KILOMETRE ? formatMetres(metres) : formatKilometres(metres);

export const formatCount = (count: number) => wholeNumber.format(count);

export const formatQuantity = (count: number, one: string, many: string) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

export const formatPercent = (ratio: number) => `${oneDecimal.format(ratio * 100)}%`;

export const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
};

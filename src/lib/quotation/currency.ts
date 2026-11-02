/** The currencies a quotation is made in: the RMB total is converted to one of these. */
export const QUOTE_CURRENCIES = ["INR", "USD"] as const;

const CURRENCIES:{ code: string; name: string; major: string; minor: string }[] = [
  { code: "CNY", name: "Chinese Yuan", major: "Yuan", minor: "Fen" },
  { code: "USD", name: "US Dollar", major: "US Dollars", minor: "Cents" },
  { code: "INR", name: "Indian Rupee", major: "Rupees", minor: "Paise" },
  { code: "EUR", name: "Euro", major: "Euros", minor: "Cents" },
  { code: "GBP", name: "British Pound", major: "Pounds", minor: "Pence" },
  { code: "AED", name: "UAE Dirham", major: "Dirhams", minor: "Fils" },
  { code: "SAR", name: "Saudi Riyal", major: "Riyals", minor: "Halalas" },
  { code: "QAR", name: "Qatari Riyal", major: "Riyals", minor: "Dirhams" },
  { code: "OMR", name: "Omani Rial", major: "Rials", minor: "Baisa" },
  { code: "KWD", name: "Kuwaiti Dinar", major: "Dinars", minor: "Fils" },
  { code: "SGD", name: "Singapore Dollar", major: "Singapore Dollars", minor: "Cents" },
  { code: "AUD", name: "Australian Dollar", major: "Australian Dollars", minor: "Cents" },
  { code: "CAD", name: "Canadian Dollar", major: "Canadian Dollars", minor: "Cents" },
  { code: "JPY", name: "Japanese Yen", major: "Yen", minor: "Sen" },
  { code: "MYR", name: "Malaysian Ringgit", major: "Ringgit", minor: "Sen" },
  { code: "THB", name: "Thai Baht", major: "Baht", minor: "Satang" },
  { code: "ZAR", name: "South African Rand", major: "Rand", minor: "Cents" },
];

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  }
  return parts.join(" ");
}

function international(n: number): string {
  if (n === 0) return "Zero";
  const scales = ["", "Thousand", "Million", "Billion", "Trillion"];
  const parts: string[] = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${belowThousand(chunk)}${scales[i] ? ` ${scales[i]}` : ""}`);
    n = Math.floor(n / 1000);
    i++;
  }
  return parts.join(" ");
}

function indian(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? international(crore) : belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** 1250.5, "USD" -> "US Dollars One Thousand Two Hundred Fifty and Fifty Cents Only". */
export function amountInWords(amount: number, currency: string): string {
  const info = CURRENCIES.find((c) => c.code === currency);
  const major = info?.major ?? currency;
  const minor = info?.minor ?? "Cents";
  const safe = Math.max(0, Math.round(amount * 100));
  const whole = Math.floor(safe / 100);
  const cents = safe % 100;
  const words = currency === "INR" ? indian(whole) : international(whole);
  const minorWords = cents ? ` and ${currency === "INR" ? indian(cents) : international(cents)} ${minor}` : "";
  return `${major} ${words}${minorWords} Only`;
}

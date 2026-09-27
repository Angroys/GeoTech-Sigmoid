import type { FC } from "react";

const PRINT_CSS = `
@page {
  size: A4;
  margin: 16mm 14mm 22mm;
  @bottom-left {
    content: "Semnături / Signatures: ____________________";
    font: 8pt sans-serif;
  }
  @bottom-right {
    content: "Pagina " counter(page) " din " counter(pages);
    font: 8pt sans-serif;
  }
}
@media print {
  html, body { background: #ffffff !important; }
}
`;

export const ReportPrintStyles: FC = () => {
  return <style>{PRINT_CSS}</style>;
};

import type { Express, RequestHandler } from "express";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { getIncomeStatement } from "./accounting-v2";

const TEMPLATE_PATH = path.join(process.cwd(), "server", "assets", "f1040sc.pdf");

const P1 = "topmostSubform[0].Page1[0]";
const L8_17 = `${P1}.Lines8-17[0]`;
const L18_27 = `${P1}.Lines18-27[0]`;

const FIELD_MAP = {
  taxpayerName: `${P1}.f1_1[0]`,
  ssn: `${P1}.f1_2[0]`,
  principalBusiness: `${P1}.f1_3[0]`,
  businessCode: `${P1}.BComb[0].f1_4[0]`,
  businessName: `${P1}.f1_5[0]`,
  ein: `${P1}.DComb[0].f1_6[0]`,
  address: `${P1}.f1_7[0]`,
  cityStateZip: `${P1}.f1_8[0]`,
  accountingCash: `${P1}.c1_1[0]`,
  accountingAccrual: `${P1}.c1_1[1]`,
  accountingOther: `${P1}.c1_1[2]`,
  materiallyYes: `${P1}.c1_4[0]`,
  materiallyNo: `${P1}.c1_4[1]`,
  line1: `${P1}.f1_10[0]`,
  line2: `${P1}.f1_11[0]`,
  line3: `${P1}.f1_12[0]`,
  line4: `${P1}.f1_13[0]`,
  line5: `${P1}.f1_14[0]`,
  line6: `${P1}.f1_15[0]`,
  line7: `${P1}.f1_16[0]`,
  line8: `${L8_17}.f1_17[0]`,
  line9: `${L8_17}.f1_18[0]`,
  line10: `${L8_17}.f1_19[0]`,
  line11: `${L8_17}.f1_20[0]`,
  line12: `${L8_17}.f1_21[0]`,
  line13: `${L8_17}.f1_22[0]`,
  line14: `${L8_17}.f1_23[0]`,
  line15: `${L8_17}.f1_24[0]`,
  line16a: `${L8_17}.f1_25[0]`,
  line16b: `${L8_17}.f1_26[0]`,
  line17: `${L8_17}.f1_27[0]`,
  line18: `${L18_27}.f1_28[0]`,
  line19: `${L18_27}.f1_29[0]`,
  line20a: `${L18_27}.f1_30[0]`,
  line20b: `${L18_27}.f1_31[0]`,
  line21: `${L18_27}.f1_32[0]`,
  line22: `${L18_27}.f1_33[0]`,
  line23: `${L18_27}.f1_34[0]`,
  line24a: `${L18_27}.f1_35[0]`,
  line24b: `${L18_27}.f1_36[0]`,
  line25: `${L18_27}.f1_37[0]`,
  line26: `${L18_27}.f1_38[0]`,
  line27a: `${L18_27}.f1_40[0]`,
  line27_other_desc: `${L18_27}.f1_39[0]`,
  line28: `${P1}.f1_41[0]`,
  line29: `${P1}.f1_42[0]`,
  line30: `${P1}.Line30_ReadOrder[0].f1_43[0]`,
  line31: `${P1}.f1_45[0]`,
};

const CODE_TO_LINE: Record<string, string> = {
  "8100": "8",
  "9200": "9",
  "8850": "10",
  "8200": "11",
  "9100": "13",
  "8300": "15",
  "8400": "17",
  "8500": "18",
  "9000": "20b",
  "8600": "22",
  "8900": "24a",
  "8950": "24b",
  "8700": "25",
  "9050": "26",
  "9300": "27a",
  "5000": "27a",
  "5010": "27a",
  "5090": "27a",
  "8800": "27a",
  "9150": "27a",
};

function fmt(n: number): string {
  return n.toFixed(2);
}

export function registerScheduleCExportRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.get("/api/ops/tax-center/schedule-c/export", isAuthenticated, async (_req, res) => {
    try {
      const settingsResult = await db.execute(sql`
        SELECT taxpayer_name, taxpayer_ssn, address, city, tax_state, zip,
               principal_business, business_code, filing_type, state_name
        FROM tax_settings WHERE id = 'default' LIMIT 1
      `);
      const settings = (settingsResult.rows[0] as any) || {};

      const currentYear = new Date().getFullYear();
      const yearStart = new Date(currentYear, 0, 1);
      const yearEnd = new Date();

      const v2Report = await getIncomeStatement({ start: yearStart, end: yearEnd });
      const grossRevenue = v2Report.totalRevenue;

      const refundResult = await db.execute(sql`
        SELECT COALESCE(SUM(amount), 0) as total FROM stripe_payments
        WHERE status = 'refunded' AND created_at >= ${yearStart}
      `);
      const refunds = Number((refundResult.rows[0] as any)?.total || 0);

      const netGrossIncome = grossRevenue - refunds;

      const lineAmounts: Record<string, number> = {};
      for (const exp of v2Report.expenses) {
        const line = CODE_TO_LINE[(exp as any).code];
        if (line) {
          if (line === "24b") {
            lineAmounts[line] = (lineAmounts[line] || 0) + Math.abs((exp as any).amount) * 0.5;
          } else {
            lineAmounts[line] = (lineAmounts[line] || 0) + Math.abs((exp as any).amount);
          }
        }
      }

      try {
        const mileageResult = await db.execute(sql`
          SELECT COALESCE(SUM(miles), 0) as total_miles
          FROM expenses
          WHERE is_void IS NOT TRUE AND miles IS NOT NULL AND miles > 0
            AND date >= ${yearStart}
        `);
        const totalMiles = Number((mileageResult.rows[0] as any)?.total_miles || 0);
        if (totalMiles > 0) {
          lineAmounts["9"] = totalMiles * 0.70;
        }
      } catch {}

      const totalExpenses =
        (lineAmounts["8"] || 0) +
        (lineAmounts["9"] || 0) +
        (lineAmounts["10"] || 0) +
        (lineAmounts["11"] || 0) +
        (lineAmounts["13"] || 0) +
        (lineAmounts["15"] || 0) +
        (lineAmounts["16b"] || 0) +
        (lineAmounts["17"] || 0) +
        (lineAmounts["18"] || 0) +
        (lineAmounts["20b"] || 0) +
        (lineAmounts["22"] || 0) +
        (lineAmounts["24a"] || 0) +
        (lineAmounts["24b"] || 0) +
        (lineAmounts["25"] || 0) +
        (lineAmounts["26"] || 0) +
        (lineAmounts["27a"] || 0);

      const netProfit = netGrossIncome - totalExpenses;

      const templateBytes = fs.readFileSync(TEMPLATE_PATH);
      const pdfDoc = await PDFDocument.load(templateBytes);
      const form = pdfDoc.getForm();

      function setTextField(fieldKey: keyof typeof FIELD_MAP, value: string) {
        try {
          const field = form.getTextField(FIELD_MAP[fieldKey]);
          field.setText(value);
        } catch {}
      }

      function checkBox(fieldKey: keyof typeof FIELD_MAP) {
        try {
          const field = form.getCheckBox(FIELD_MAP[fieldKey]);
          field.check();
        } catch {}
      }

      setTextField("taxpayerName", settings.taxpayer_name || "");
      setTextField("ssn", settings.taxpayer_ssn || "");
      setTextField("principalBusiness", settings.principal_business || "Web Design & Development Services");
      setTextField("businessCode", settings.business_code || "541510");
      setTextField("businessName", settings.taxpayer_name || "");

      const cityStateZip = [settings.city, settings.tax_state, settings.zip].filter(Boolean).join(", ");
      setTextField("address", settings.address || "");
      setTextField("cityStateZip", cityStateZip);

      checkBox("accountingCash");
      checkBox("materiallyYes");

      setTextField("line1", fmt(grossRevenue));
      setTextField("line2", fmt(refunds));
      setTextField("line3", fmt(netGrossIncome));
      setTextField("line5", fmt(netGrossIncome));
      setTextField("line7", fmt(netGrossIncome));

      if (lineAmounts["8"]) setTextField("line8", fmt(lineAmounts["8"]));
      if (lineAmounts["9"]) setTextField("line9", fmt(lineAmounts["9"]));
      if (lineAmounts["10"]) setTextField("line10", fmt(lineAmounts["10"]));
      if (lineAmounts["11"]) setTextField("line11", fmt(lineAmounts["11"]));
      if (lineAmounts["13"]) setTextField("line13", fmt(lineAmounts["13"]));
      if (lineAmounts["15"]) setTextField("line15", fmt(lineAmounts["15"]));
      if (lineAmounts["16b"]) setTextField("line16b", fmt(lineAmounts["16b"]));
      if (lineAmounts["17"]) setTextField("line17", fmt(lineAmounts["17"]));
      if (lineAmounts["18"]) setTextField("line18", fmt(lineAmounts["18"]));
      if (lineAmounts["20b"]) setTextField("line20b", fmt(lineAmounts["20b"]));
      if (lineAmounts["24a"]) setTextField("line24a", fmt(lineAmounts["24a"]));
      if (lineAmounts["24b"]) setTextField("line24b", fmt(lineAmounts["24b"]));
      if (lineAmounts["25"]) setTextField("line25", fmt(lineAmounts["25"]));
      if (lineAmounts["26"]) setTextField("line26", fmt(lineAmounts["26"]));

      if (lineAmounts["22"]) setTextField("line22", fmt(lineAmounts["22"]));

      if (lineAmounts["27a"]) {
        setTextField("line27a", fmt(lineAmounts["27a"]));
        setTextField("line27_other_desc", "Software, Bank Fees, Processing Fees, Client Gifts");
      }

      setTextField("line28", fmt(totalExpenses));
      setTextField("line29", fmt(netProfit));
      setTextField("line31", fmt(netProfit));

      form.flatten();

      const pdfBytes = await pdfDoc.save();

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="BlackRidge_ScheduleC_${currentYear}.pdf"`
      );
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error("Schedule C export error:", error);
      res.status(500).json({ message: "Failed to generate Schedule C PDF" });
    }
  });
}

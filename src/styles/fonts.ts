import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
export const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz", "SOFT"], display: "swap" });
export const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
export const fontVars = `${display.variable} ${body.variable}`;

import type { Metadata } from "next";
import { Converter } from "./ui";

export const metadata: Metadata = {
  title: "plan2ifc — 2D plan to IFC",
  description: "Turn a floor plan into an openable IFC4 BIM file.",
};

export default function Page() {
  return <Converter />;
}

import { z } from "zod";

export const cadastralNumberSchema = z
  .string()
  .regex(/^\d{10}$/)
  .brand<"CadastralNumber">();

export type CadastralNumber = z.infer<typeof cadastralNumberSchema>;

const positionSchema = z.tuple([z.number(), z.number()]);

export const parcelDtoSchema = z.object({
  cadastral_number: cadastralNumberSchema,
  area_ha: z.number().nonnegative(),
  land_use: z.string().min(1),
  location: z.string().min(1),
  geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(positionSchema)) }),
});

export type ParcelDto = z.output<typeof parcelDtoSchema>;

export const ownerParcelsResponseSchema = z.object({ parcels: z.array(parcelDtoSchema) });

import { useState } from "react";

import { vineyardUrl, WORKSPACE_ROUTE } from "@/entities/role";
import { useSession, type Session } from "@/entities/session";
import { createSurveyId } from "@/entities/survey";
import { ApiError } from "@/shared/api";
import { useForm } from "@/shared/lib/form";
import { navigate } from "@/shared/lib/router";

import { saveProcessingVineyard, saveSampleVineyard } from "../api/save-vineyard";
import { useImageryCheck } from "./use-imagery-check";
import { useTileFiles } from "./use-tile-files";
import { useTileUpload } from "./use-tile-upload";
import { INITIAL_VALUES, validateAddVineyard, type AddVineyardValues } from "./validation";

const SERVICE_UNAVAILABLE = 503;

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export const useAddVineyardForm = () => {
  const session = useSession();
  const imagery = useImageryCheck();
  const tiles = useTileFiles();
  const tileUpload = useTileUpload();
  const [canUseSample, setCanUseSample] = useState(false);

  const describeVineyard = async (values: AddVineyardValues, owner: Session) => {
    const imageryUrl = values.imageryUrl.trim();
    const imageryBounds = imageryUrl ? await imagery.ensure(imageryUrl) : null;
    return {
      id: createSurveyId(values.name.trim()),
      values,
      imagery: imageryBounds ? { url: imageryUrl, bounds: imageryBounds } : null,
      session: owner,
    };
  };

  const uploadTiles = async (vineyard: Awaited<ReturnType<typeof describeVineyard>>) => {
    try {
      await tileUpload.upload({
        surveyId: vineyard.id,
        name: vineyard.values.name.trim(),
        location: vineyard.values.location.trim(),
        capturedOn: vineyard.values.capturedOn,
        imageryUrl: vineyard.imagery?.url ?? null,
        tiles: tiles.tiles,
      });
    } catch (error) {
      if (isAbort(error)) throw new ApiError("Upload cancelled. The vineyard was not added.");
      if (error instanceof ApiError && error.status === SERVICE_UNAVAILABLE && vineyard.session.isDemo) {
        setCanUseSample(true);
      }
      throw error;
    }
  };

  const form = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateAddVineyard,
    submit: async submitted => {
      if (!session) throw new ApiError("Sign in again to add a vineyard.");
      if (tiles.tiles.length === 0) throw new ApiError("Add the image tiles of the drone survey.");
      if (tiles.problems.length > 0) throw new ApiError("Remove the files that are not valid tiles, then try again.");
      const vineyard = await describeVineyard(submitted, session);
      await uploadTiles(vineyard);
      await saveProcessingVineyard(vineyard, tiles.tiles.length);
    },
    successMessage: "Tiles uploaded. Processing has started.",
    onSuccess: () => navigate(WORKSPACE_ROUTE.owner),
  });

  const addWithSample = async () => {
    if (!session) return;
    const vineyard = await describeVineyard(form.values, session);
    await saveSampleVineyard(vineyard);
    navigate(vineyardUrl("owner", vineyard.id));
  };

  const checkImagery = () => void imagery.check(form.values.imageryUrl.trim()).catch(() => undefined);

  return { ...form, imagery, tiles, upload: tileUpload, canUseSample, addWithSample, checkImagery };
};

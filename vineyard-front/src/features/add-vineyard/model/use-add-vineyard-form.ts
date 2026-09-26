import { useRef } from "react";

import { vineyardUrl } from "@/entities/role";
import { useSession } from "@/entities/session";
import { SURVEY_FILE_NAMES, type SurveyId } from "@/entities/survey";
import { ApiError } from "@/shared/api";
import { useForm } from "@/shared/lib/form";
import { navigate } from "@/shared/lib/router";

import { saveVineyard } from "../api/save-vineyard";
import { useImageryCheck } from "./use-imagery-check";
import { useSurveyFiles, type SurveyFilesState } from "./use-survey-files";
import { INITIAL_VALUES, validateAddVineyard } from "./validation";

const incompleteFilesError = ({ summary }: SurveyFilesState) => {
  const problems = [...summary.missing, ...summary.invalid].map(key => SURVEY_FILE_NAMES[key]);
  return new ApiError(`The survey data is not complete. Add or fix: ${problems.join(", ")}.`);
};

export const useAddVineyardForm = () => {
  const session = useSession();
  const imagery = useImageryCheck();
  const files = useSurveyFiles();
  const createdId = useRef<SurveyId | null>(null);

  const form = useForm({
    initialValues: INITIAL_VALUES,
    validate: validateAddVineyard,
    submit: async submitted => {
      if (!session) throw new ApiError("Sign in again to add a vineyard.");
      const surveyFiles = files.toSurveyFiles();
      if (!surveyFiles) throw incompleteFilesError(files);
      const imageryUrl = submitted.imageryUrl.trim();
      const imageryBounds = imageryUrl ? await imagery.ensure(imageryUrl) : null;
      createdId.current = await saveVineyard({ values: submitted, files: surveyFiles, imageryBounds, session });
    },
    successMessage: "Vineyard added. Opening its map.",
    onSuccess: () => {
      if (createdId.current) navigate(vineyardUrl("owner", createdId.current));
    },
  });

  const checkImagery = () => void imagery.check(form.values.imageryUrl.trim()).catch(() => undefined);

  return { ...form, imagery, files, checkImagery };
};

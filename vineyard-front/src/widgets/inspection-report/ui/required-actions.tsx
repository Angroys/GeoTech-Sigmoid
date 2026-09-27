import { useId, useState, type FC } from "react";

import { RuledLines } from "./report-parts";

const BLANK_LINES = 4;

export const RequiredActions: FC = () => {
  const [text, setText] = useState("");
  const fieldId = useId();

  return (
    <div>
      <label htmlFor={fieldId} className="sr-only">
        Required actions and deadlines
      </label>
      <textarea
        id={fieldId}
        rows={4}
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder="For example: replant the missing vines in V1, row V1-12, by 15 November 2026."
        className="w-full resize-y rounded-md border border-black/25 px-2.5 py-2 text-sm print:hidden"
      />
      {text.trim() ? (
        <p className="hidden text-sm whitespace-pre-wrap print:block">{text}</p>
      ) : (
        <div className="hidden print:block">
          <RuledLines count={BLANK_LINES} />
        </div>
      )}
    </div>
  );
};

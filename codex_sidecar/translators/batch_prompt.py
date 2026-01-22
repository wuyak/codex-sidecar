def looks_like_translate_batch_prompt(text: str) -> bool:
    """
    Detect the packed batch-translation prompt used by `watch/translate_batch.py`.

    Important:
    - For batch prompts, the caller already includes strict marker-preservation
      instructions. Wrapping it again with a generic "translate everything" prompt
      would cause the model to translate the instruction header/markers, breaking
      unpacking on the sidecar.
    """
    s = str(text or "")
    return (
        "<<<SIDECAR_TRANSLATE_BATCH_V1>>>" in s
        and "<<<SIDECAR_ITEM:" in s
        and "<<<SIDECAR_END>>>" in s
    )


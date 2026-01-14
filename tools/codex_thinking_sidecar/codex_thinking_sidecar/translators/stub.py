class StubTranslator:
    """
    占位翻译器：不调用任何外部 API。

    目的：先把“监听 → 提取 → 推送/展示”的链路跑通，后续再替换为真实翻译实现。
    """

    def translate(self, text: str) -> str:
        if not text:
            return ""
        # 这里用可辨识的占位，便于你确认链路是否工作。
        return "【中文占位】\n" + text


class NoneTranslator:
    def translate(self, text: str) -> str:
        return ""


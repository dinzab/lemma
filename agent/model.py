import os
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

load_dotenv()

DEFAULT_PROVIDER = os.getenv("MODEL_PROVIDER", "nvidia")


def get_model(model_name: str = DEFAULT_PROVIDER):
    """
    Get the chat model based on the provider name.

    Supports:
    - 'nvidia'     (default): Uses NVIDIA's OpenAI-compatible endpoint.
                              Reads NVIDIA_API_KEY and NVIDIA_MODEL_NAME from env.
    - 'openrouter':            Uses OpenRouter.
                              Reads OPENROUTER_API_KEY (and optionally
                              OPENROUTER_MODEL_NAME) from env.
    - 'openai':                Uses OpenAI directly.
                              Reads OPENAI_API_KEY (and optionally
                              OPENAI_MODEL_NAME, defaults to gpt-4o).
    """
    if model_name in ("nvidia", "nvidea_enpoint", "nvidea"):
        api_key = os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDEA_API_KEY")
        if not api_key:
            raise RuntimeError(
                "NVIDIA_API_KEY is not set. Either set it in agent/.env or "
                "switch MODEL_PROVIDER to another supported provider."
            )
        return ChatOpenAI(
            model=os.getenv("NVIDIA_MODEL_NAME", "meta/llama-3.3-70b-instruct"),
            openai_api_key=api_key,
            openai_api_base=os.getenv(
                "NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"
            ),
        )

    if model_name == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not set.")
        return ChatOpenAI(
            model=os.getenv(
                "OPENROUTER_MODEL_NAME", "meta-llama/llama-3.3-70b-instruct"
            ),
            openai_api_key=api_key,
            openai_api_base="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://bacprep-ai.com",
                "X-Title": "BacPrep AI",
            },
        )

    if model_name == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set.")
        return ChatOpenAI(
            model=os.getenv("OPENAI_MODEL_NAME", "gpt-4o"),
            openai_api_key=api_key,
        )

    raise ValueError(f"Unknown model provider: {model_name}")

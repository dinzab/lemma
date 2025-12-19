import os
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

load_dotenv()

def get_model(model_name: str = "nvidea_enpoint"):
    """
    Get the chat model based on the name.
    
    Supports:
    - 'openrouter': Uses OpenRouter API (default)
    - 'openai': Uses OpenAI directly
    
    Future support: 'groq', 'gemini'
    """
    if model_name == "openrouter":
        # Use OpenRouter with a good reasoning model
        return ChatOpenAI(
            model="meta-llama/llama-3.3-70b-instruct",  # Fast and powerful
            openai_api_key=os.getenv("OPENROUTER_API_KEY"),
            openai_api_base="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://bacprep-ai.com",
                "X-Title": "BacPrep AI",
            }
        )
    if model_name == "nvidea_enpoint":
        # Use OpenRouter with a good reasoning model
        return ChatOpenAI(
            model="minimaxai/minimax-m2",  # Fast and powerful
            openai_api_key=os.getenv("NVIDIA_API_KEY"),
            openai_api_base="https://integrate.api.nvidia.com/v1"
        )
    elif model_name == "openai":
        # Use OpenAI directly (fallback)
        return ChatOpenAI(
            model="gpt-4o",
            openai_api_key=os.getenv("OPENAI_API_KEY")
        )
    # Placeholder for future models
    # elif model_name == "groq":
    #     return ChatGroq(model="...")
    # elif model_name == "gemini":
    #     return ChatGoogleGenerativeAI(model="...")
    else:
        raise ValueError(f"Unknown model name: {model_name}")

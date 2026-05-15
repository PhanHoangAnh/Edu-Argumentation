import google.generativeai as genai

# Replace with your actual key
genai.configure(api_key="AIzaSyC4EkdSMz-PHhFInb4OGI90B3LRRiJAlTA")

def list_edu_models():
    print("--- Available Gemini Models for Edu-Augmentation ---")
    for m in genai.list_models():
        # Filtering for models that support the 'generateContent' method
        if 'generateContent' in m.supported_generation_methods:
            print(f"Model ID: {m.name}")
            print(f"Display Name: {m.display_name}")
            print(f"Input Token Limit: {m.input_token_limit}")
            print("-" * 30)

if __name__ == "__main__":
    list_edu_models()

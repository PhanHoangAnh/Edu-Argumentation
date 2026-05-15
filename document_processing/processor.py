import os
import json
import fitz  # PyMuPDF
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load variables from .env
load_dotenv()

class DocumentProcessor:
    def __init__(self):
        # Securely fetch API key
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in .env file")
            
        self.client = genai.Client(api_key=api_key)
        self.model_id = "gemini-3.1-pro-preview"
        self.output_dir = "output"
        self.assets_dir = os.path.join(self.output_dir, "assets")
        
        os.makedirs(self.assets_dir, exist_ok=True)

    def extract_physical_images(self, file_path: str):
        """Extracts all embedded images from the PDF locally."""
        print(f"[*] Physically extracting images from {file_path}...")
        doc = fitz.open(file_path)
        image_map = []

        for page_index in range(len(doc)):
            page = doc[page_index]
            for img_index, img in enumerate(page.get_images(full=True)):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                ext = base_image["ext"]
                
                img_name = f"page_{page_index+1}_img_{img_index+1}.{ext}"
                img_path = os.path.join(self.assets_dir, img_name)
                
                with open(img_path, "wb") as f:
                    f.write(image_bytes)
                
                image_map.append({
                    "figure_id": f"fig_p{page_index+1}_{img_index+1}",
                    "uri": f"assets/{img_name}",
                    "page": page_index + 1
                })
        return image_map

    def process_document(self, file_path: str):
        # 1. Local Image Extraction
        local_assets = self.extract_physical_images(file_path)

        # 2. Upload to Gemini File API
        print(f"[*] Uploading {file_path} to Gemini...")
        uploaded_file = self.client.files.upload(file=file_path)

        # 3. Strict Tutor Instruction with LaTeX Math Contract
        system_instruction = """
        ROLE: You are a Strict Expert Tutor and Academic Researcher.
        TASK: Deconstruct the document into a high-detail Syllabus JSON for an interactive book.
        
        STRICT FORMATTING RULES:
        1. MATHEMATICAL FORMULAS: 
           - You MUST use LaTeX for all mathematical expressions.
           - For inline math, use: \\( equation \\).
           - For block/standalone math, use: $$ equation $$.
           - Never use plain text or Unicode for symbols like summation, limits, or fractions.
        
        2. HIERARCHY: Course -> Topics -> Subjects -> Problems.
        
        3. NO INFORMATION LOSS: Capture every nuance. If the document explains a process, describe it step-by-step in 'comprehensive_analysis_md'.
        
        4. FIGURE MAPPING: Use the format 'fig_p[PAGE]_[INDEX]' (e.g., fig_p5_1). 
           Explain the 'Learning Objective' of each diagram.

        JSON SCHEMA:
        {
          "course_title": "string",
          "topics": [{
            "topic_name": "string",
            "subjects": [{
              "subject_title": "string",
              "problem_statement": "string",
              "comprehensive_analysis_md": "string",
              "learning_figures": [{ "figure_id": "string", "learning_objective": "string" }],
              "quiz": [{"question": "string", "answer": "string"}]
            }]
          }]
        }
        """

        print(f"[*] Analysis in progress (Applying LaTeX Math Protocol)...")
        try:
            response = self.client.models.generate_content(
                model=self.model_id,
                contents=[uploaded_file, "Generate the Master Syllabus JSON with LaTeX math support."],
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                ),
            )
            
            full_data = json.loads(response.text)
            full_data["extracted_assets"] = local_assets
            return full_data
        except Exception as e:
            raise Exception(f"Analysis failed: {str(e)}")

if __name__ == "__main__":
    try:
        processor = DocumentProcessor()
        # Ensure this file exists in your source/ directory
        source_file = "source/AWS-Certified-ML-Engineer-Associate-Slides.pdf"
        
        if os.path.exists(source_file):
            result = processor.process_document(source_file)
            output_path = "output/augmented_tutorial.json"
            with open(output_path, "w") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            print(f"[+] Success! Math-ready tutorial saved to {output_path}")
        else:
            print(f"[!] Error: {source_file} not found.")
    except Exception as e:
        print(f"[!] Runtime Error: {e}")
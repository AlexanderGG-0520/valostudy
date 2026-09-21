import json
from pathlib import Path

TEMPLATE = Path(__file__).parent / 'prompts' / 'coaching.md'

def render_prompt(profile, context, extraction):
    return TEMPLATE.read_text().format(
        profile_json=json.dumps(profile, ensure_ascii=False, indent=2),
        context_json=json.dumps(context, ensure_ascii=False),
        extraction_json=json.dumps(extraction, ensure_ascii=False, indent=2),
    )

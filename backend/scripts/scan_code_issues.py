import os
import re
import ast

def scan_backend():
    findings = {
        "sql_injections": [],
        "unprotected_endpoints": [],
        "hardcoded_secrets": [],
        "float_in_financial_logic": [],
        "syntax_or_import_errors": []
    }

    raw_sql_re = re.compile(r'text\s*\(\s*f["\']', re.IGNORECASE)
    secret_re = re.compile(r'(password|secret|api_key|token)\s*=\s*["\'][^"\']{4,}["\']', re.IGNORECASE)
    router_route_re = re.compile(r'@router\.(get|post|put|patch|delete)\s*\((.*?)\)', re.DOTALL)

    app_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app")

    for root, dirs, files in os.walk(app_dir):
        for f in files:
            if not f.endswith(".py"):
                continue
            fpath = os.path.join(root, f)
            rel_path = os.path.relpath(fpath, os.path.dirname(os.path.dirname(__file__)))

            with open(fpath, "r", encoding="utf-8", errors="ignore") as file_obj:
                content = file_obj.read()
                lines = content.splitlines()

            # 1. AST Syntax Check
            try:
                ast.parse(content)
            except SyntaxError as e:
                findings["syntax_or_import_errors"].append({
                    "file": rel_path,
                    "line": e.lineno,
                    "error": str(e)
                })

            # 2. Raw SQL with f-strings
            for idx, line in enumerate(lines, 1):
                if raw_sql_re.search(line):
                    # Check if variables are interpolated
                    if "{" in line and "}" in line:
                        findings["sql_injections"].append({
                            "file": rel_path,
                            "line": idx,
                            "snippet": line.strip()
                        })

                # 3. Hardcoded secrets (exclude models, settings, tests)
                if "config.py" not in rel_path and "test" not in rel_path and "models" not in rel_path:
                    m = secret_re.search(line)
                    if m and "os.getenv" not in line and "get_settings" not in line and "default=" not in line:
                        # exclude common schema fields or empty defaults
                        val = m.group(0)
                        if not any(skip in val.lower() for skip in ['""', "''", "none", "hash", "argon", "bcrypt", "column"]):
                            findings["hardcoded_secrets"].append({
                                "file": rel_path,
                                "line": idx,
                                "snippet": val.strip()
                            })

            # 4. Check router endpoints for auth dependencies
            if "routers" in rel_path:
                # Check if router itself has dependencies=[Depends(...)]
                has_router_auth = bool(re.search(r'router\s*=\s*APIRouter\([^)]*dependencies\s*=\s*\[[^\]]*(?:get_current_user|require_role|require_permission)', content))
                
                # Find all def endpoint functions
                for match in re.finditer(r'@router\.(get|post|put|patch|delete)\s*\((.*?)\)\s*\n(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\):', content, re.DOTALL):
                    http_method = match.group(1).upper()
                    route_path = match.group(2).split(",")[0].strip("\"' ")
                    fn_name = match.group(3)
                    fn_params = match.group(4)
                    
                    # Endpoints that are intentionally public
                    is_public = (
                        "auth.py" in rel_path and fn_name in ["login_endpoint", "refresh_endpoint", "login", "refresh"] or
                        "shop.py" in rel_path or
                        "suppliers.py" in rel_path and "public" in route_path or
                        "purchases.py" in rel_path and "guest" in route_path or
                        fn_name in ["health", "health_check"]
                    )
                    
                    has_auth = has_router_auth or any(auth_tok in fn_params for auth_tok in [
                        "get_current_user", "require_role", "require_permission", 
                        "current_user_dep", "admin", "current_user", "user="
                    ])
                    
                    if not is_public and not has_auth:
                        findings["unprotected_endpoints"].append({
                            "file": rel_path,
                            "function": fn_name,
                            "method": http_method,
                            "path": route_path
                        })

    return findings

if __name__ == "__main__":
    import json
    results = scan_backend()
    with open("backend_code_review.json", "w", encoding="utf-8") as out:
        json.dump(results, out, indent=2)
    print(f"Backend code scan complete:")
    print(f"  SQL Injection suspects: {len(results['sql_injections'])}")
    print(f"  Unprotected endpoints:  {len(results['unprotected_endpoints'])}")
    print(f"  Hardcoded secrets:      {len(results['hardcoded_secrets'])}")
    print(f"  Syntax errors:          {len(results['syntax_or_import_errors'])}")

"""Offline entry point using the same request contract as POST /plan."""
import argparse
import json
from pathlib import Path

from .api import with_constraints
from .models import PlanRequest
from .planner import plan_route

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("request", type=Path)
parser.add_argument("--output", type=Path, default=Path("route-output"))
args = parser.parse_args()
request = with_constraints(PlanRequest.model_validate_json(args.request.read_text()))
result = plan_route(request)
route_name = "demo_route.geojson" if request.path_mode == "demo_headlands" else "route.geojson"
args.output.mkdir(parents=True, exist_ok=True)
(args.output / "report.json").write_text(json.dumps(result["report"], indent=2))
if result["route"] is None:
    # Do not leave a previous successful export masquerading as this result.
    (args.output / route_name).unlink(missing_ok=True)
    print(f"No route available. Diagnostics written to {args.output / 'report.json'}")
    raise SystemExit(2)
(args.output / route_name).write_text(json.dumps(result["route"]))
print(f"Route and validation report written to {args.output}")

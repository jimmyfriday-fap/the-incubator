from fastapi import FastAPI

app = FastAPI()


@app.get("/rates")
def rates() -> dict[str, float]:
    return {}

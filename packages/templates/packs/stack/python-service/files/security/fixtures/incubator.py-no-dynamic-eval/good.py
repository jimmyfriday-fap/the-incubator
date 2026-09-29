import ast


def compute(expr: str) -> object:
    return ast.literal_eval(expr)

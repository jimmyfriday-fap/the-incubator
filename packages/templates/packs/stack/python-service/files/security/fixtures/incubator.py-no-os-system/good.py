import subprocess


def list_dir(path: str) -> None:
    subprocess.run(["ls", path], check=True)

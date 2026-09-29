import subprocess


def run(command: str) -> None:
    subprocess.run(command, shell=True, check=True)

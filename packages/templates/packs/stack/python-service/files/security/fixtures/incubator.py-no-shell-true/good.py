import subprocess


def run(command: str, args: list[str]) -> None:
    subprocess.run([command, *args], shell=False, check=True)

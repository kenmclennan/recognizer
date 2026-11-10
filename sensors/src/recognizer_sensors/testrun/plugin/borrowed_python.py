import os
import sys


def main(arguments):
    interpreter = arguments[0]
    paths = [path for path in sys.path[1:] if path]
    inherited = os.environ.get("PYTHONPATH")
    os.environ["PYTHONPATH"] = os.pathsep.join([*paths, *([inherited] if inherited else [])])
    os.execv(interpreter, [interpreter, *arguments[1:]])


if __name__ == "__main__":
    main(sys.argv[1:])

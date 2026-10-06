# improve kernel running speed
import os

os.environ["KERAS_BACKEND"] = "plaidml.keras.backend"

# a nice way of filtering out deprecated warnings
import warnings

warnings.filterwarnings("ignore")

# multiline output
from IPython.core.interactiveshell import InteractiveShell

InteractiveShell.ast_node_interactivity = "all"

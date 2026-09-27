"""Vendored minimum of the SAM 3 fine-tuning code (run3c checkpoint).

Source: gs://marcaj-sam3-ajai-0957394607/code/ft/ (model.py, predict.py, vectorize.py).
Every module here imports torch / sam3 / cv2 / rasterio lazily or at module level only inside
this subpackage; nothing outside ``sam3_model`` imports it at import time.
"""

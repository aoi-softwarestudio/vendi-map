# -*- coding: utf-8 -*-
import os
import matplotlib
matplotlib.use('Agg')  # Non-interactive background rendering
import matplotlib.pyplot as plt
import numpy as np

# Directory to temporarily save charts
CHART_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_charts")
os.makedirs(CHART_DIR, exist_ok=True)

def generate_trend_radar(keyword, scores, filename_prefix="chart"):
    """
    Generates a premium dark-themed radar chart for a given keyword and scores.
    scores: dict with keys like 'YouTube', 'Instagram', 'TikTok', 'X', 'Google SEO'
    returns: absolute path to the generated image file.
    """
    labels = list(scores.keys())
    values = [float(scores[k]) for k in labels]
    
    num_vars = len(labels)
    # Compute angle for each axis
    angles = np.linspace(0, 2 * np.pi, num_vars, endpoint=False).tolist()
    
    # Complete the loop
    values += values[:1]
    angles += angles[:1]
    
    # Create plot with premium dark background
    fig, ax = plt.subplots(figsize=(6, 6), subplot_kw=dict(polar=True), facecolor='#05060b')
    ax.set_facecolor('#0a0c16')
    
    # Draw axis lines and labels
    plt.xticks(angles[:-1], labels, color='#94a3b8', size=11, fontweight='bold')
    ax.tick_params(colors='#64748b', grid_color=(1.0, 1.0, 1.0, 0.08))
    
    # Set grid styling
    ax.spines['polar'].set_color((1.0, 1.0, 1.0, 0.12))
    ax.spines['polar'].set_linewidth(1.5)
    
    # Draw radar path
    ax.plot(angles, values, color='#ec4899', linewidth=2.5, linestyle='solid')
    # Fill radar area with pink-to-purple glow
    ax.fill(angles, values, color='#8b5cf6', alpha=0.3)
    
    # Add neon-glow points
    ax.scatter(angles[:-1], values[:-1], color='#ec4899', s=50, edgecolor='white', zorder=5)
    
    # Set radial limits
    ax.set_ylim(0, 100)
    ax.set_rlabel_position(180 / num_vars) # Move r-labels out of the way
    
    # Title
    title_text = f"SocialIntent AI Trend: {keyword}"
    plt.title(title_text, color='#f8fafc', size=15, weight='bold', pad=25)
    
    # Save file
    safe_keyword = "".join([c for c in keyword if c.isalnum() or c in (' ', '_', '-')]).rstrip()
    safe_keyword = safe_keyword.replace(' ', '_')
    output_path = os.path.join(CHART_DIR, f"{filename_prefix}_{safe_keyword}.png")
    
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='#05060b')
    plt.close()
    
    print(f"Visual generator: Chart successfully generated at {output_path}")
    return output_path

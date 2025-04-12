from setuptools import setup

package_name = 'tf2_web_republisher_py'

setup(
    name=package_name,
    version='0.0.0',
    # Explicitly list the directory containing the Python code
    packages=[package_name], 
    # Specify the root directory for the package listed above
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        # msg/srv/action files are handled by ament_python build type implicitly
    ],
    install_requires=['setuptools','numpy','pyquaternion'],
    # Try installing as a directory instead of an egg
    zip_safe=False, 
    maintainer='schoen',
    maintainer_email='schoen.andrewj@gmail.com',
    description='Python port of tf2_web_republisher_py for ROS2',
    license='BSD-2-Clause',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            # Ensure this points to the correct module path relative to the found package
            'tf2_web_republisher_py = tf2_web_republisher_py.tf2_web_republisher_py:main'
        ],
    },
)
